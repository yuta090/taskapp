-- =============================================================================
-- メンバー情報が見える範囲（名前・アバター・メールアドレス・招待・組織のメンバー）
-- 確定設計: Fable 裁定 2026-09-12
--
-- 規則:
--   profiles（名前・アバター）… 見えるのは、自分／同じ組織の社内メンバーとして一緒にいる人／自分が入っている space の
--     組織の社内スタッフ／同じ space の人（app_can_see_profile）。ログインしていない人（anon）には表の権限を付けない。
--     ログイン中の人（authenticated）には TRUNCATE・REFERENCES・TRIGGER を付けない。
--   rpc_get_org_members（組織のメンバー一覧）… 呼べるのは、その組織の社内メンバー（owner / admin / member）だけ。
--     メールアドレスは、その組織の owner / admin にだけ返す（ほかの人には null）。返す列の形は変えない。
--   invites（招待）… ログイン中の人は、メールアドレス（email）と合言葉（token）の列を読めない（サーバーは今までどおり
--     全列）。行が見えるのは、組織の owner / admin・招待を作った人・その space の役割が admin / editor の社内メンバーだけ。
--   org_memberships（組織のメンバー）… 見えるのは、自分の行と、その組織の社内メンバー。
--   二要素認証の RESTRICTIVE ポリシー（mfa_required_when_enrolled）はそのまま。
--   人で引く索引（org_memberships・space_memberships の user_id）を足す（profiles の判定で使う）。
--   新しい関数は SECURITY DEFINER・search_path = public。実行権は authenticated と service_role だけ。
--
-- ロック: 先頭で profiles・invites・org_memberships を access exclusive（ポリシーの差し替え）で、space_memberships を
--   share（索引を足す）で、まとめて押さえてから変える（途中で強いロックに上げない）。待つのは 3 秒まで。
--   取れなければ全体を取り消すので、流し直す。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。
--   本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 冪等: create or replace・drop policy if exists → create・create index if not exists・権限は同じ形に置き直す。
--   2回流しても同じ。
-- 可逆: 節 1〜4 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、置き換える物の土台の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.profiles, public.invites, public.org_memberships in access exclusive mode;
  lock table public.space_memberships in share mode;
end $$;

-- 置き換える物が、土台（下の migration）か本 migration の形であること。違えば止める
--   （本番だけにある手直しを上書きしないため）
--   rpc_get_org_members: 20260223_000_rpc_get_org_members.sql
--   profiles の読み取り: 20240203_000_profiles.sql・invites: 20260703_008_rls_invites.sql・
--   org_memberships: 20260703_003_rls_membership.sql
do $$
declare
  v_bad text := '';
  v_md5 text;
  v_n   int;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_get_org_members(uuid)')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];
  if v_md5 is null or v_md5 not in ('78afaea09e75e7d6dbdbf2031572345c', '3b3ecfb965239e045d1ab884d42d212a') then
    v_bad := v_bad || format(' rpc_get_org_members の定義（md5=%s）;', coalesce(v_md5, 'なし'));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
                    and ((policyname = 'Profiles are viewable by authenticated users' and qual like '%auth.role()%authenticated%')
                      or policyname = 'profiles_select_visible')) then
    v_bad := v_bad || ' profiles の読み取りのポリシー;';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'invites' and cmd = 'SELECT'
                    and ((policyname = 'invites_select_internal' and qual like '%app_is_org_internal(org_id)%')
                      or policyname = 'invites_select_manager')) then
    v_bad := v_bad || ' invites の読み取りのポリシー;';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'org_memberships' and cmd = 'SELECT'
                    and ((policyname = 'org_memberships_select_member' and qual like '%app_is_org_member(org_id)%')
                      or policyname = 'org_memberships_select_internal_or_self')) then
    v_bad := v_bad || ' org_memberships の読み取りのポリシー;';
  end if;

  -- 使う補助関数がある（どれも SECURITY DEFINER）
  select count(*) into v_n
    from pg_proc p
   where p.oid in (to_regprocedure('public.app_is_org_internal(uuid)'),
                   to_regprocedure('public.app_is_org_owner_or_admin(uuid)'),
                   to_regprocedure('public.app_space_role_of_caller(uuid)'))
     and p.prosecdef;
  if v_n <> 3 then
    v_bad := v_bad || format(' 補助関数=%s（3 のはず）;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'member directory visibility: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: profiles … 見えるのは、一緒に仕事をしている関係の人だけ。anon には表の権限を付けない
-- =============================================================================

create or replace function public.app_can_see_profile(p_user uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    -- 自分
    p_user = auth.uid()
    -- 同じ組織の社内メンバーとして一緒にいる（相手の役割は問わない）
    or exists (
      select 1
        from public.org_memberships me
        join public.org_memberships them on them.org_id = me.org_id
       where me.user_id = auth.uid()
         and me.role in ('owner', 'admin', 'member')
         and them.user_id = p_user
    )
    -- 自分が入っている space の組織の社内スタッフ（space に行が無い社内メンバーも含む）
    or exists (
      select 1
        from public.space_memberships me
        join public.spaces s on s.id = me.space_id
        join public.org_memberships staff on staff.org_id = s.org_id
       where me.user_id = auth.uid()
         and staff.user_id = p_user
         and staff.role in ('owner', 'admin', 'member')
    )
    -- 同じ space の人
    or exists (
      select 1
        from public.space_memberships me
        join public.space_memberships them on them.space_id = me.space_id
       where me.user_id = auth.uid()
         and them.user_id = p_user
    ),
    false);
$$;

comment on function public.app_can_see_profile(uuid) is
  '呼んだ人がその人の名前・アバター（profiles）を見られるか: 自分／同じ組織の社内として同席／自分の space の組織の社内スタッフ／同じ space の人';

revoke all on function public.app_can_see_profile(uuid) from public, anon;
grant execute on function public.app_can_see_profile(uuid) to authenticated, service_role;

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists profiles_select_visible on public.profiles;
create policy profiles_select_visible
  on public.profiles
  for select
  to authenticated
  using ( public.app_can_see_profile(id) );

-- ログインしていない人には表の権限を付けない。ログイン中の人には読み・書き・消す・保守（MAINTAIN）だけを付ける
--   （TRUNCATE・REFERENCES・TRIGGER は付けない）
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select, insert, update, delete, maintain on table public.profiles to authenticated;

-- 人で引く索引（app_can_see_profile の「呼んだ人の行」を探すのに使う）
create index if not exists org_memberships_user_id_idx on public.org_memberships (user_id);
create index if not exists space_memberships_user_id_idx on public.space_memberships (user_id);

-- ロールバック（節 1。読み取りのポリシー・権限を土台の形に戻し、関数と索引を外す）:
--   drop policy if exists profiles_select_visible on public.profiles;
--   create policy "Profiles are viewable by authenticated users" on public.profiles
--     for select using ( auth.role() = 'authenticated' );
--   grant all on table public.profiles to anon;
--   grant all on table public.profiles to authenticated;
--   drop function if exists public.app_can_see_profile(uuid);
--   drop index if exists public.space_memberships_user_id_idx;
--   drop index if exists public.org_memberships_user_id_idx;
-- =============================================================================
-- 節 2: rpc_get_org_members … 呼べるのは組織の社内メンバーだけ。メールアドレスは owner / admin にだけ
--   土台: 20260223_000_rpc_get_org_members.sql（節 0 で md5 を確かめ済み）。返す列の形は変えない。
-- =============================================================================

create or replace function public.rpc_get_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_can_see_email boolean;
begin
  -- 認証チェック
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- 組織のメンバー一覧を見られるのは、その組織の社内メンバー（owner / admin / member）だけ
  if not public.app_is_org_internal(p_org_id) then
    raise exception 'Access denied: only internal members can list organization members';
  end if;

  -- メールアドレスは、その組織の owner / admin にだけ返す
  v_can_see_email := public.app_is_org_owner_or_admin(p_org_id);

  return query
  select
    om.user_id,
    coalesce(p.display_name, 'User') as display_name,
    p.avatar_url,
    case when v_can_see_email then au.email::text else null end as email,
    om.role,
    om.created_at as joined_at
  from org_memberships om
  left join profiles p on p.id = om.user_id
  left join auth.users au on au.id = om.user_id
  where om.org_id = p_org_id
  order by
    case om.role
      when 'owner' then 1
      when 'member' then 2
      when 'client' then 3
      else 4
    end,
    om.created_at asc;
end;
$$;

revoke execute on function public.rpc_get_org_members(uuid) from public, anon;
grant execute on function public.rpc_get_org_members(uuid) to authenticated, service_role;

-- ロールバック（節 2。土台の本文に戻す。search_path と実行権は今と同じ）:
--   create or replace function public.rpc_get_org_members(p_org_id uuid)
--   returns table (
--     user_id uuid,
--     display_name text,
--     avatar_url text,
--     email text,
--     role text,
--     joined_at timestamptz
--   )
--   language plpgsql
--   stable
--   security definer
--   set search_path = public
--   as $$
--   BEGIN
--     -- 認証チェック
--     IF auth.uid() IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- 呼び出し元がこの組織のメンバーであることを確認
--     IF NOT EXISTS (
--       SELECT 1 FROM org_memberships om_check
--       WHERE om_check.org_id = p_org_id AND om_check.user_id = auth.uid()
--     ) THEN
--       RAISE EXCEPTION 'Access denied: not a member of this organization';
--     END IF;
--   
--     RETURN QUERY
--     SELECT
--       om.user_id,
--       COALESCE(p.display_name, 'User') as display_name,
--       p.avatar_url,
--       au.email::text,
--       om.role,
--       om.created_at as joined_at
--     FROM org_memberships om
--     LEFT JOIN profiles p ON p.id = om.user_id
--     LEFT JOIN auth.users au ON au.id = om.user_id
--     WHERE om.org_id = p_org_id
--     ORDER BY
--       CASE om.role
--         WHEN 'owner' THEN 1
--         WHEN 'member' THEN 2
--         WHEN 'client' THEN 3
--         ELSE 4
--       END,
--       om.created_at ASC;
--   END;
--   $$;
--   revoke execute on function public.rpc_get_org_members(uuid) from public, anon;
--   grant execute on function public.rpc_get_org_members(uuid) to authenticated, service_role;
-- =============================================================================
-- 節 3: invites … メールアドレスと合言葉（token）の列はログイン中の人に読ませない。行は管理する人だけ
-- =============================================================================

-- 列の権限: 表全体の SELECT を外し、email・token のほかの列にだけ SELECT を付け直す
--   （表全体の SELECT が残っていると、列だけ外しても全列が読めるため）。service_role は変えない
revoke select on table public.invites from authenticated;
grant select (id, org_id, space_id, role, expires_at, accepted_at, created_by, created_at, invitee_name)
  on table public.invites to authenticated;

drop policy if exists invites_select_internal on public.invites;
drop policy if exists invites_select_manager on public.invites;
create policy invites_select_manager
  on public.invites
  for select
  to authenticated
  using (
    public.app_is_org_owner_or_admin(org_id)
    or created_by = (select auth.uid())
    or (public.app_is_org_internal(org_id) and public.app_space_role_of_caller(space_id) in ('admin', 'editor'))
  );

-- ロールバック（節 3。読み取りのポリシーと列の権限を土台の形に戻す）:
--   drop policy if exists invites_select_manager on public.invites;
--   create policy invites_select_internal on public.invites
--     for select to authenticated using ( public.app_is_org_internal(org_id) );
--   revoke select (id, org_id, space_id, role, expires_at, accepted_at, created_by, created_at, invitee_name)
--     on table public.invites from authenticated;
--   grant select on table public.invites to authenticated;
-- =============================================================================
-- 節 4: org_memberships … 見えるのは自分の行と、その組織の社内メンバー
-- =============================================================================

drop policy if exists org_memberships_select_member on public.org_memberships;
drop policy if exists org_memberships_select_internal_or_self on public.org_memberships;
create policy org_memberships_select_internal_or_self
  on public.org_memberships
  for select
  to authenticated
  using ( user_id = (select auth.uid()) or public.app_is_org_internal(org_id) );

-- ロールバック（節 4。読み取りのポリシーを土台の形に戻す）:
--   drop policy if exists org_memberships_select_internal_or_self on public.org_memberships;
--   create policy org_memberships_select_member on public.org_memberships
--     for select to authenticated using ( user_id = auth.uid() or public.app_is_org_member(org_id) );
-- =============================================================================
-- 節 5: 末尾の確認（何も変えない）… ポリシー・列と表の権限・関数・索引が想定どおり。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_n    int;
begin
  -- 読み取りのポリシー: 3表とも新しい1本だけ（土台の物は無い）
  select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname)
    into v_text
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and tablename in ('profiles', 'invites', 'org_memberships');
  if v_text is distinct from 'invites.invites_select_manager,org_memberships.org_memberships_select_internal_or_self,profiles.profiles_select_visible' then
    v_bad := v_bad || ' 読み取りのポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 二要素の RESTRICTIVE は3表に残る
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename in ('profiles', 'invites', 'org_memberships')
     and policyname = 'mfa_required_when_enrolled' and permissive = 'RESTRICTIVE';
  if v_n <> 3 then
    v_bad := v_bad || format(' 二要素の RESTRICTIVE=%s（3 のはず）;', v_n);
  end if;

  -- 権限: profiles は anon に無く、authenticated は読み・書き・消す・保守だけ（service_role などほかの役割は変えない）
  select coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a
                    where a::text like 'anon=%' or a::text like 'authenticated=%'), '-')
    into v_text
    from pg_class c
   where c.oid = 'public.profiles'::regclass;
  if v_text is distinct from 'authenticated=arwdm/postgres' then
    v_bad := v_bad || ' profiles の権限: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- invites: authenticated は email・token を読めず、role は読める（表全体の SELECT は無い）
  select format('email=%s token=%s role=%s table=%s',
                has_column_privilege('authenticated', 'public.invites', 'email', 'SELECT')::text,
                has_column_privilege('authenticated', 'public.invites', 'token', 'SELECT')::text,
                has_column_privilege('authenticated', 'public.invites', 'role', 'SELECT')::text,
                has_table_privilege('authenticated', 'public.invites', 'SELECT')::text)
    into v_text;
  if v_text is distinct from 'email=false token=false role=true table=false' then
    v_bad := v_bad || ' invites の権限: ' || v_text || ';';
  end if;

  -- 関数: どちらも SECURITY DEFINER・search_path = public・実行できるのは authenticated と service_role だけ。
  --   rpc_get_org_members は本 migration の本文
  select string_agg(format('%s:%s:%s:%s/%s/%s/%s', p.proname, p.prosecdef::text, array_to_string(p.proconfig, ';'),
                           has_function_privilege('public', p.oid, 'execute')::text,
                           has_function_privilege('anon', p.oid, 'execute')::text,
                           has_function_privilege('authenticated', p.oid, 'execute')::text,
                           has_function_privilege('service_role', p.oid, 'execute')::text),
                    ' ' order by p.proname)
    into v_text
    from pg_proc p
   where p.oid in (to_regprocedure('public.app_can_see_profile(uuid)'), to_regprocedure('public.rpc_get_org_members(uuid)'));
  if v_text is distinct from
       'app_can_see_profile:true:search_path=public:false/false/true/true '
       'rpc_get_org_members:true:search_path=public:false/false/true/true' then
    v_bad := v_bad || ' 関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.rpc_get_org_members(uuid)'))
     is distinct from '3b3ecfb965239e045d1ab884d42d212a' then
    v_bad := v_bad || ' rpc_get_org_members の本文;';
  end if;

  -- 索引
  select count(*) into v_n
    from pg_class
   where oid in (coalesce(to_regclass('public.org_memberships_user_id_idx'), 0),
                 coalesce(to_regclass('public.space_memberships_user_id_idx'), 0));
  if v_n <> 2 then
    v_bad := v_bad || format(' 人で引く索引=%s（2 のはず）;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'member directory visibility: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 5）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_member_directory_visibility.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 節 0 と同じ（rpc_get_org_members の md5 が 78afaea09e75e7d6dbdbf2031572345c・3表の
--      読み取りのポリシーが土台の形）。
--   2) 適用後（本番）: 節 5 が通る。デモ組織の相手先で rpc_get_org_members を呼ぶと断られる。
--   3) 画面: 設定→メンバー（owner はメールあり・member はメールなし）・プロジェクト設定→メンバー・タスクのコメントの名前・
--      ファイル一覧の名前・相手先ポータルのコメントの名前・招待の作成 / 再送 / 受諾・はじめての設定の招待の数。
-- =============================================================================

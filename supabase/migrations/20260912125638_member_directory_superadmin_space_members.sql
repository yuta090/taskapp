-- =============================================================================
-- メンバー情報が見える範囲の続き（運営のフラグ・space のメンバー一覧）
-- 確定設計: Fable 裁定 2026-09-12
--
-- 規則:
--   profiles.is_superadmin … ログイン中の人（authenticated）は読めない。運営かどうかは rpc_is_superadmin() で確かめる。
--     ほかの列は今までどおり読める（どの行が見えるかは profiles_select_visible のまま）。書き込みの権限は変えない。
--   system_integration_configs … 読み書きできるのは運営だけ。判定は rpc_is_superadmin() で行い、対象はログイン中の人。
--   rpc_get_space_members … 呼んだ人の space の役割が client / vendor（外部）のときは、社内（admin / editor / viewer）と、
--     自分と同じ役割の人だけを返す（client には vendor を、vendor には client を返さない）。社内の呼び手には全員。
--     返す列は同じ。
--   関数は SECURITY DEFINER・search_path = public。実行権は今までどおり（authenticated と service_role）。
-- 前提: 20260912123257_member_directory_visibility.sql の後に当てる（節 0 で確かめる）。本人のセッションで
--   is_superadmin を読むコードが無いこと（画面の直しを先に出す）。
--
-- ロック: 先頭で system_integration_configs を access exclusive（ポリシーの書き換え）で押さえてから変える。待つのは 3 秒まで。
--   取れなければ全体を取り消すので、流し直す。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため）。
-- 冪等: create or replace・alter policy・権限は同じ形に置き直す。2回流しても同じ。
-- 可逆: 節 1〜3 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、変える物の土台の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.system_integration_configs in access exclusive mode;
end $$;

-- 変える物が、土台（下の migration）か本 migration の形であること。違えば止める
--   rpc_get_space_members: 20240203_000_profiles.sql・system_integration_configs のポリシー: 20260306_000_system_integration_configs.sql
do $$
declare
  v_bad    text := '';
  v_md5    text;
  v_n      int;
  v_text   text;
  v_attnum int2;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_get_space_members(uuid)')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];
  if v_md5 is null or v_md5 not in ('ef8d63a9d54ddd95a76bc9ff01820048', 'b74cd05e6ed91cde1fdca436dc534d6a') then
    v_bad := v_bad || format(' rpc_get_space_members の定義（md5=%s）;', coalesce(v_md5, 'なし'));
  end if;

  -- 20260912123257_member_directory_visibility.sql が当たっている
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.profiles'::regclass and polname = 'profiles_select_visible') then
    v_bad := v_bad || ' 先に 20260912123257_member_directory_visibility.sql を当てる;';
  end if;

  -- 運営の判定の関数がある（SECURITY DEFINER・authenticated が実行できる）
  select count(*) into v_n
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_is_superadmin()')
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_n <> 1 then
    v_bad := v_bad || ' rpc_is_superadmin;';
  end if;

  -- system_integration_configs の4つのポリシーが、土台か本 migration の形
  --   （条件の文を組み立てるのはこの4つだけ。組み立てると、条件の中で読む表に読みのロックが付くため）
  select count(*) into v_n
    from pg_policy pol
   where pol.polrelid = 'public.system_integration_configs'::regclass
     and pol.polname in ('superadmin can view system configs', 'superadmin can insert system configs',
                         'superadmin can update system configs', 'superadmin can delete system configs')
     and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
         ~ '(p\.is_superadmin = true|rpc_is_superadmin\(\))';
  if v_n <> 4 then
    v_bad := v_bad || format(' system_integration_configs のポリシー=%s（4 のはず）;', v_n);
  end if;

  -- 上の4つのほかに、is_superadmin の列を読むポリシー・ビュー・呼んだ人の権限で動く関数が無い
  --   （列の権限を外すと、呼んだ人の権限では読めなくなるため。ポリシーとビューは列への依存の記録で、関数は本文で探す。
  --    見張りのトリガー関数は NEW / OLD を見るだけなので除く）
  select a.attnum into v_attnum
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass and a.attname = 'is_superadmin' and not a.attisdropped;
  if v_attnum is null then
    v_bad := v_bad || ' profiles.is_superadmin が無い;';
  end if;

  select string_agg(x, ', ' order by x)
    into v_text
    from (
      select pol.polrelid::regclass::text || '.' || pol.polname as x
        from pg_depend d
        join pg_policy pol on pol.oid = d.objid
       where d.classid = 'pg_policy'::regclass
         and d.refclassid = 'pg_class'::regclass
         and d.refobjid = 'public.profiles'::regclass
         and d.refobjsubid = v_attnum
         and not (pol.polrelid = 'public.system_integration_configs'::regclass
                  and pol.polname in ('superadmin can view system configs', 'superadmin can insert system configs',
                                      'superadmin can update system configs', 'superadmin can delete system configs'))
      union
      select r.ev_class::regclass::text
        from pg_depend d
        join pg_rewrite r on r.oid = d.objid
       where d.classid = 'pg_rewrite'::regclass
         and d.refclassid = 'pg_class'::regclass
         and d.refobjid = 'public.profiles'::regclass
         and d.refobjsubid = v_attnum
         and r.ev_class <> 'public.profiles'::regclass
      union
      select p.oid::regprocedure::text
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and not p.prosecdef and p.prosrc ~* 'is_superadmin'
         and p.oid is distinct from to_regprocedure('public.guard_profiles_superadmin()')
    ) s;
  if v_text is not null then
    v_bad := v_bad || ' is_superadmin を読むポリシー・ビュー・関数: ' || v_text || ';';
  end if;

  if v_bad <> '' then
    raise exception 'member directory superadmin space members: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: profiles.is_superadmin はログイン中の人に読ませない（ほかの列は今までどおり）
-- =============================================================================

-- 表全体の SELECT を外し、is_superadmin のほかの列にだけ SELECT を付け直す
--   （表全体の SELECT が残っていると、列だけ外しても全列が読めるため）。書き込みの権限と service_role は変えない
revoke select on table public.profiles from authenticated;
grant select (id, display_name, avatar_url, created_at, updated_at, onboarding_flags, reminder_emails_enabled, due_reminder_enabled)
  on table public.profiles to authenticated;

-- ロールバック（節 1。表全体の SELECT に戻す）:
--   revoke select (id, display_name, avatar_url, created_at, updated_at, onboarding_flags, reminder_emails_enabled, due_reminder_enabled)
--     on table public.profiles from authenticated;
--   grant select on table public.profiles to authenticated;
-- =============================================================================
-- 節 2: system_integration_configs … 運営の判定を rpc_is_superadmin() で。対象はログイン中の人
--   ポリシーの名前と操作はそのまま、対象の役割と条件だけを書き換える。
--   (select …) で包むと、行ごとではなく1文に1回だけ呼ぶ（announcements・announcement_reads と同じ形）。
-- =============================================================================

alter policy "superadmin can view system configs" on public.system_integration_configs
  to authenticated
  using ( (select public.rpc_is_superadmin()) );

alter policy "superadmin can insert system configs" on public.system_integration_configs
  to authenticated
  with check ( (select public.rpc_is_superadmin()) );

alter policy "superadmin can update system configs" on public.system_integration_configs
  to authenticated
  using ( (select public.rpc_is_superadmin()) );

alter policy "superadmin can delete system configs" on public.system_integration_configs
  to authenticated
  using ( (select public.rpc_is_superadmin()) );

-- ロールバック（節 2。土台の形に戻す）:
--   alter policy "superadmin can view system configs" on public.system_integration_configs
--     to public using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true) );
--   alter policy "superadmin can insert system configs" on public.system_integration_configs
--     to public with check ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true) );
--   alter policy "superadmin can update system configs" on public.system_integration_configs
--     to public using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true) );
--   alter policy "superadmin can delete system configs" on public.system_integration_configs
--     to public using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true) );
-- =============================================================================
-- 節 3: rpc_get_space_members … 外部（client / vendor）の呼び手には、社内と自分と同じ役割の人だけ
--   土台: 20240203_000_profiles.sql（節 0 で md5 を確かめ済み）。返す列は同じ。
-- =============================================================================

create or replace function public.rpc_get_space_members(p_space_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  -- 認証チェック
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- 呼び出し元がこのspaceのメンバーであることを確認（その space の役割を控える）
  select sm_check.role into v_caller_role
    from space_memberships sm_check
   where sm_check.space_id = p_space_id
     and sm_check.user_id = auth.uid();

  if v_caller_role is null then
    raise exception 'Access denied: not a member of this space';
  end if;

  return query
  select
    sm.user_id,
    coalesce(p.display_name, 'User') as display_name,
    p.avatar_url,
    sm.role
  from space_memberships sm
  left join profiles p on p.id = sm.user_id
  where sm.space_id = p_space_id
    -- 外部（client / vendor）の呼び手には、社内の人と、自分と同じ役割の人だけを返す
    and (v_caller_role not in ('client', 'vendor')
         or sm.role in ('admin', 'editor', 'viewer')
         or sm.role = v_caller_role);
end;
$$;

revoke execute on function public.rpc_get_space_members(uuid) from public, anon;
grant execute on function public.rpc_get_space_members(uuid) to authenticated, service_role;

-- ロールバック（節 3。土台の本文に戻す。search_path と実行権は今と同じ）:
--   create or replace function public.rpc_get_space_members(p_space_id uuid)
--   returns table (
--     user_id uuid,
--     display_name text,
--     avatar_url text,
--     role text
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
--     -- 呼び出し元がこのspaceのメンバーであることを確認
--     IF NOT EXISTS (
--       SELECT 1 FROM space_memberships sm_check
--       WHERE sm_check.space_id = p_space_id AND sm_check.user_id = auth.uid()
--     ) THEN
--       RAISE EXCEPTION 'Access denied: not a member of this space';
--     END IF;
--   
--     RETURN QUERY
--     SELECT
--       sm.user_id,
--       COALESCE(p.display_name, 'User') as display_name,
--       p.avatar_url,
--       sm.role
--     FROM space_memberships sm
--     LEFT JOIN profiles p ON p.id = sm.user_id
--     WHERE sm.space_id = p_space_id;
--   END;
--   $$;
--   revoke execute on function public.rpc_get_space_members(uuid) from public, anon;
--   grant execute on function public.rpc_get_space_members(uuid) to authenticated, service_role;
-- =============================================================================
-- 節 4: 末尾の確認（何も変えない）… 列の権限・ポリシー・関数が想定どおり。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_n    int;
begin
  -- profiles: authenticated は is_superadmin だけ読めず、ほかの列は読める（表全体の SELECT は無い）。書き込みは今までどおり
  select string_agg(a.attname::text, ',' order by a.attname)
    into v_text
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', 'public.profiles', a.attname::text, 'SELECT') is distinct from (a.attname <> 'is_superadmin');
  if v_text is not null then
    v_bad := v_bad || ' profiles の列の権限が想定と違う列: ' || v_text || ';';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     or not has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    v_bad := v_bad || ' profiles の表の権限;';
  end if;

  -- system_integration_configs の4つのポリシー: 対象は authenticated だけ・条件は rpc_is_superadmin() だけ
  select count(*) into v_n
    from pg_policy pol
   where pol.polrelid = 'public.system_integration_configs'::regclass
     and pol.polname in ('superadmin can view system configs', 'superadmin can insert system configs',
                         'superadmin can update system configs', 'superadmin can delete system configs')
     and pol.polroles = array['authenticated'::regrole::oid]
     and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
         ~ '^\s*\(\s*SELECT (public\.)?rpc_is_superadmin\(\) AS rpc_is_superadmin\)\s*$';
  if v_n <> 4 then
    v_bad := v_bad || format(' system_integration_configs のポリシー=%s（4 のはず）;', v_n);
  end if;

  -- rpc_get_space_members: 本 migration の本文・SECURITY DEFINER・search_path = public・実行権は authenticated と service_role
  select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_get_space_members(uuid)');
  if v_text is distinct from 'b74cd05e6ed91cde1fdca436dc534d6a:true:search_path=public:false/false/true/true' then
    v_bad := v_bad || ' rpc_get_space_members: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  if v_bad <> '' then
    raise exception 'member directory superadmin space members: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 4）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_member_directory_superadmin_space_members.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 本人のセッションで is_superadmin を読むコードが本番に無い（画面の直しが出ている）。
--      節 0 と同じ（rpc_get_space_members の md5 が ef8d63a9d54ddd95a76bc9ff01820048・profiles_select_visible がある）。
--   2) 適用後（本番）: 節 4 が通る。運営が /admin に入れる・運営のツール連携の設定を読み書きできる。
--   3) 画面: プロジェクトのメンバー一覧（社内は全員・相手先は社内と相手先・協力会社は社内と協力会社）。
-- =============================================================================

-- =============================================================================
-- 組織の役割と space の役割をそろえる（RC-1）
-- 確定設計: Fable 裁定 2026-09-12
--
-- 規則:
--   組織の役割ごとに、space で持てる役割が決まっている:
--     組織 client（相手先・協力会社）       → space は client / vendor だけ
--     組織 owner / member（社内メンバー）  → space は admin / editor / viewer だけ
--   space_memberships … 作るときと、space_id・user_id・role を書き換えるときに、その人の組織の役割で確かめる
--     （組織のメンバーでない人は入れない決まりはそのまま）。
--   org_memberships … role を書き換えたトランザクションの終わり（commit の時点）に、その人のその組織の全 space の
--     役割がそろっていることを確かめる（遅延の制約トリガー。組織 → space の順に書き換える途中では止めない）。
--   rpc_update_org_member_role … 組織の役割を変えると、space の役割も同じトランザクションでそろえる:
--     社内 → client: space の admin / editor / viewer を client に
--     client → 社内（owner / member）: space の client / vendor を viewer に
--   rpc_update_space_member_role … 組織の役割で持てない space の役割は、書く前に分かる文言で断る。
--     vendor は、その space が代理店モード（spaces.agency_mode）のときだけ。
--   task_pricing … 読み書きできるのは、その space で社内扱いの社内メンバー（app_is_space_internal）。
--   関数は SECURITY DEFINER・search_path = public。実行権は今までどおり（2つの RPC は authenticated と service_role・
--     トリガー関数は誰にも付けない）。
--
-- ロック: 先頭で org_memberships・space_memberships を share row exclusive で、task_pricing を access exclusive で
--   押さえてから変える（途中で強いロックに上げない。トリガーの作成・作り直しは share row exclusive で足りる。
--   ポリシーの書き換えは表の access exclusive が要る）。待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   トリガーは drop しない（既にある物は create or replace trigger・新しい制約トリガーは無いときだけ作る）。
--   DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクションなので、
--   ロックは最後まで持つ）。
-- 前提: 今の行が規則を満たしている（満たさない行が1つでもあれば、末尾の確認で止まる）。
-- 冪等: create or replace function / trigger・新しい制約トリガーは無いときだけ作る・alter policy。2回流しても同じ。
-- 可逆: 節 1〜5 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、作り直す関数・ポリシーの土台の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.org_memberships, public.space_memberships in share row exclusive mode;
  lock table public.task_pricing in access exclusive mode;
end $$;

-- 作り直す関数の今の定義が、土台（または本 migration の定義）と1文字でも違えば止める
--   （本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）
--   enforce_space_member_in_org: 20260912100114_space_scope_invariants.sql
--   rpc_update_org_member_role・rpc_update_space_member_role: 20260706003110_rpc_membership_writes.sql
do $$
declare
  v_bad text;
begin
  select string_agg(e.fn, ', ' order by e.fn)
    into v_bad
    from (values
      ('enforce_space_member_in_org()', '78e661ffdb08a5866c860f6e68ba379b', 'a09b78e50b94eaef2bb916d9dcd341a0'),
      ('rpc_update_org_member_role(uuid,uuid,text)', '0189be5f2c642ac6f519b4e065391968', '0d54b0e37e0ec3a106631e93ced9b4aa'),
      ('rpc_update_space_member_role(uuid,uuid,text)', '59379fae11729561fbbdeca98302403f', '4b1214b97dda33ac8c5faf2376e2be62')
    ) as e(fn, base_md5, new_md5)
    left join pg_proc p on p.oid = to_regprocedure('public.' || e.fn)
   where p.oid is null
      or md5(p.prosrc) not in (e.base_md5, e.new_md5)
      or not p.prosecdef
      or p.proconfig is distinct from array['search_path=public'];

  if v_bad is not null then
    raise exception 'org space role consistency: 次の関数の今の定義が、土台にした migration の定義と違います: %', v_bad;
  end if;

  -- 書き換える task_pricing の4ポリシーがある（20260703_011_rls_task_pricing_internal_only.sql）
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'task_pricing'
         and policyname in ('task_pricing_select_member', 'task_pricing_insert_member',
                            'task_pricing_update_member', 'task_pricing_delete_member')) <> 4 then
    raise exception 'org space role consistency: task_pricing の4ポリシーがそろっていません';
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: space のメンバーは、その space の組織のメンバーで、組織の役割で持てる space の役割だけ
--   土台: 20260912100114_space_scope_invariants.sql（組織のメンバーかどうかの確認と文言はそのまま）。
-- =============================================================================

create or replace function public.enforce_space_member_in_org()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org_role text;
begin
  select om.role into v_org_role
    from public.spaces s
    join public.org_memberships om
      on om.org_id = s.org_id
     and om.user_id = new.user_id
   where s.id = new.space_id;

  if v_org_role is null then
    raise exception 'space member must be a member of the space organization';
  end if;

  -- 組織の役割で持てる space の役割（組織 client → client / vendor・組織 owner / member → admin / editor / viewer）
  if new.role <> all (case when v_org_role = 'client' then array['client', 'vendor']
                           else array['admin', 'editor', 'viewer'] end) then
    raise exception 'space role % is not allowed for organization role %', new.role, v_org_role;
  end if;

  return new;
end;
$$;

comment on function public.enforce_space_member_in_org() is
  'space_memberships に入る人は、その space の組織のメンバーだけ。space の役割は組織の役割で決まる（組織 client → client / vendor・組織 owner / member → admin / editor / viewer）';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.enforce_space_member_in_org() from public, anon, authenticated, service_role;

-- role の書き換えでも確かめる（drop はせず、既にあるトリガーを作り直す）
create or replace trigger trg_enforce_space_member_in_org
  before insert or update of space_id, user_id, role on public.space_memberships
  for each row
  execute function public.enforce_space_member_in_org();

-- ロールバック（節 1。土台の本文と、space_id・user_id だけを見るトリガーに戻す）:
--   create or replace function public.enforce_space_member_in_org()
--     returns trigger
--     language plpgsql
--     security definer
--     set search_path = public
--   as $$
--   begin
--     if not exists (
--       select 1
--         from public.spaces s
--         join public.org_memberships om
--           on om.org_id = s.org_id
--          and om.user_id = new.user_id
--        where s.id = new.space_id
--     ) then
--       raise exception 'space member must be a member of the space organization';
--     end if;
--   
--     return new;
--   end;
--   $$;
--   
--   comment on function public.enforce_space_member_in_org() is
--     'space_memberships に入る人は、その space の組織のメンバー（org_memberships に行がある人）だけ';
--   
--   create or replace trigger trg_enforce_space_member_in_org
--     before insert or update of space_id, user_id on public.space_memberships
--     for each row
--     execute function public.enforce_space_member_in_org();
-- =============================================================================
-- 節 2: 組織の役割を書き換えたら、commit の時点で、その組織の全 space の役割がそろっていること
--   遅延の制約トリガー（DEFERRABLE INITIALLY DEFERRED）。commit の時点の組織の役割で確かめる。
-- =============================================================================

create or replace function public.enforce_org_member_role_matches_spaces()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org_role text;
  v_bad      text;
begin
  -- commit の時点の組織の役割で確かめる（行が消えていれば確かめない）
  select om.role into v_org_role
    from public.org_memberships om
   where om.org_id = new.org_id
     and om.user_id = new.user_id;
  if not found then
    return null;
  end if;

  select string_agg(distinct sm.role, ', ' order by sm.role)
    into v_bad
    from public.space_memberships sm
    join public.spaces s on s.id = sm.space_id
   where s.org_id = new.org_id
     and sm.user_id = new.user_id
     and sm.role <> all (case when v_org_role = 'client' then array['client', 'vendor']
                              else array['admin', 'editor', 'viewer'] end);

  if v_bad is not null then
    raise exception 'organization role % does not match space roles (%)', v_org_role, v_bad;
  end if;

  return null;
end;
$$;

comment on function public.enforce_org_member_role_matches_spaces() is
  'org_memberships の role を書き換えたら、commit の時点で、その人のその組織の全 space の役割が組織の役割で持てるものであること';

-- トリガー専用。直接は実行させない
revoke all on function public.enforce_org_member_role_matches_spaces() from public, anon, authenticated, service_role;

-- 無いときだけ作る（制約トリガーは create or replace できない。drop もしない）
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.org_memberships'::regclass
       and tgname = 'trg_org_member_role_matches_spaces'
       and not tgisinternal
  ) then
    create constraint trigger trg_org_member_role_matches_spaces
      after update of role on public.org_memberships
      deferrable initially deferred
      for each row
      when (old.role is distinct from new.role)
      execute function public.enforce_org_member_role_matches_spaces();
  end if;
end $$;

-- ロールバック（節 2）:
--   drop trigger if exists trg_org_member_role_matches_spaces on public.org_memberships;
--   drop function if exists public.enforce_org_member_role_matches_spaces();
-- =============================================================================
-- 節 3: rpc_update_org_member_role … 組織の役割を変えると、space の役割も同じトランザクションでそろえる
--   土台: 20260706003110_rpc_membership_writes.sql（節 0 で md5 を確かめ済み）。本文は土台をそのまま写し、
--   社内への昇格（client → owner / member）で space の client / vendor を viewer にそろえる更新を1つ足しただけ。
--   create or replace なので、実行権（authenticated と service_role）はそのまま。
-- =============================================================================

create or replace function public.rpc_update_org_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_target_role text;
  v_owner_count int;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_actor and role = 'owner'
  ) then
    raise exception 'Not authorized: only org owners can change member roles';
  end if;

  if p_role not in ('owner', 'member', 'client') then
    raise exception 'Invalid role: %', p_role;
  end if;

  select role into v_target_role
  from org_memberships
  where org_id = p_org_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  -- 最終オーナーガード: 変更後にownerが0人になるなら拒否
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
    from org_memberships
    where org_id = p_org_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'Cannot demote the last owner';
    end if;
  end if;

  update org_memberships
  set role = p_role
  where org_id = p_org_id and user_id = p_user_id;

  -- クライアント化の伝播: org=client なのに space側に内部ロールが残る不整合を防ぐ
  -- （'vendor' は org=client+space=vendor が正規の組合せのため対象外）
  if p_role = 'client' then
    update space_memberships
    set role = 'client'
    where user_id = p_user_id
      and role in ('admin', 'editor', 'viewer')
      and space_id in (select id from spaces where org_id = p_org_id);
  end if;

  -- 社内への昇格の伝播: 組織が社内（owner / member）になったら、space の client / vendor を viewer に
  -- （組織の社内メンバーが持てる space の役割は admin / editor / viewer だけのため、閲覧者から始める）
  if p_role in ('owner', 'member') then
    update space_memberships
    set role = 'viewer'
    where user_id = p_user_id
      and role in ('client', 'vendor')
      and space_id in (select id from spaces where org_id = p_org_id);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ロールバック（節 3。土台の本文に戻す）:
--   create or replace function rpc_update_org_member_role(
--     p_org_id uuid,
--     p_user_id uuid,
--     p_role text
--   )
--   returns jsonb
--   language plpgsql
--   security definer
--   set search_path = public
--   as $$
--   declare
--     v_actor uuid;
--     v_target_role text;
--     v_owner_count int;
--   begin
--     v_actor := auth.uid();
--     if v_actor is null then
--       raise exception 'Authentication required';
--     end if;
--   
--     if not exists (
--       select 1 from org_memberships
--       where org_id = p_org_id and user_id = v_actor and role = 'owner'
--     ) then
--       raise exception 'Not authorized: only org owners can change member roles';
--     end if;
--   
--     if p_role not in ('owner', 'member', 'client') then
--       raise exception 'Invalid role: %', p_role;
--     end if;
--   
--     select role into v_target_role
--     from org_memberships
--     where org_id = p_org_id and user_id = p_user_id;
--   
--     if v_target_role is null then
--       raise exception 'Member not found';
--     end if;
--   
--     -- 最終オーナーガード: 変更後にownerが0人になるなら拒否
--     if v_target_role = 'owner' and p_role <> 'owner' then
--       select count(*) into v_owner_count
--       from org_memberships
--       where org_id = p_org_id and role = 'owner';
--   
--       if v_owner_count <= 1 then
--         raise exception 'Cannot demote the last owner';
--       end if;
--     end if;
--   
--     update org_memberships
--     set role = p_role
--     where org_id = p_org_id and user_id = p_user_id;
--   
--     -- クライアント化の伝播: org=client なのに space側に内部ロールが残る不整合を防ぐ
--     -- （'vendor' は org=client+space=vendor が正規の組合せのため対象外）
--     if p_role = 'client' then
--       update space_memberships
--       set role = 'client'
--       where user_id = p_user_id
--         and role in ('admin', 'editor', 'viewer')
--         and space_id in (select id from spaces where org_id = p_org_id);
--     end if;
--   
--     return jsonb_build_object('ok', true);
--   end;
--   $$;
-- =============================================================================
-- 節 4: rpc_update_space_member_role … 組織の役割で持てない space の役割は、書く前に分かる文言で断る。
--   vendor は、その space が代理店モードのときだけ。
--   土台: 20260706003110_rpc_membership_writes.sql（節 0 で md5 を確かめ済み）。本文は土台をそのまま写し、
--   組織の役割を引く1行と、書く前の確認を足しただけ。create or replace なので、実行権はそのまま。
-- =============================================================================

create or replace function public.rpc_update_space_member_role(
  p_space_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_target_role text;
  v_org_role text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select org_id into v_org_id from spaces where id = p_space_id;
  if v_org_id is null then
    raise exception 'Space not found';
  end if;

  if not exists (
    select 1 from org_memberships
    where org_id = v_org_id and user_id = v_actor and role = 'owner'
    union
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_actor and role = 'admin'
  ) then
    raise exception 'Not authorized: only org owners or space admins can change member roles';
  end if;

  if p_role not in ('admin', 'editor', 'viewer', 'client', 'vendor') then
    raise exception 'Invalid role: %', p_role;
  end if;

  select role into v_target_role
  from space_memberships
  where space_id = p_space_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  -- 組織の役割で持てる space の役割か（組織 client → client / vendor・組織 owner / member → admin / editor / viewer）。
  -- 書く前に、分かる文言で断る
  select role into v_org_role
  from org_memberships
  where org_id = v_org_id and user_id = p_user_id;

  if v_org_role = 'client' and p_role not in ('client', 'vendor') then
    raise exception '相手先の人には、相手先の役割（client / vendor）しか付けられません';
  end if;

  if coalesce(v_org_role, '') <> 'client' and p_role not in ('admin', 'editor', 'viewer') then
    raise exception '社内のメンバーには、社内の役割（admin / editor / viewer）しか付けられません';
  end if;

  -- vendor は、代理店モードの space だけ
  if p_role = 'vendor' and not exists (
    select 1 from spaces where id = p_space_id and agency_mode
  ) then
    raise exception '協力会社の役割（vendor）は、代理店モードのプロジェクトでだけ付けられます';
  end if;

  update space_memberships
  set role = p_role
  where space_id = p_space_id and user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ロールバック（節 4。土台の本文に戻す）:
--   create or replace function rpc_update_space_member_role(
--     p_space_id uuid,
--     p_user_id uuid,
--     p_role text
--   )
--   returns jsonb
--   language plpgsql
--   security definer
--   set search_path = public
--   as $$
--   declare
--     v_actor uuid;
--     v_org_id uuid;
--     v_target_role text;
--   begin
--     v_actor := auth.uid();
--     if v_actor is null then
--       raise exception 'Authentication required';
--     end if;
--   
--     select org_id into v_org_id from spaces where id = p_space_id;
--     if v_org_id is null then
--       raise exception 'Space not found';
--     end if;
--   
--     if not exists (
--       select 1 from org_memberships
--       where org_id = v_org_id and user_id = v_actor and role = 'owner'
--       union
--       select 1 from space_memberships
--       where space_id = p_space_id and user_id = v_actor and role = 'admin'
--     ) then
--       raise exception 'Not authorized: only org owners or space admins can change member roles';
--     end if;
--   
--     if p_role not in ('admin', 'editor', 'viewer', 'client', 'vendor') then
--       raise exception 'Invalid role: %', p_role;
--     end if;
--   
--     select role into v_target_role
--     from space_memberships
--     where space_id = p_space_id and user_id = p_user_id;
--   
--     if v_target_role is null then
--       raise exception 'Member not found';
--     end if;
--   
--     update space_memberships
--     set role = p_role
--     where space_id = p_space_id and user_id = p_user_id;
--   
--     return jsonb_build_object('ok', true);
--   end;
--   $$;
-- =============================================================================
-- 節 5: task_pricing … 読み書きできるのは、その space で社内扱いの社内メンバー（app_is_space_internal）
--   ポリシーの名前・操作・対象の役割はそのまま、条件だけを書き換える。
-- =============================================================================

alter policy task_pricing_select_member on public.task_pricing
  using ( public.app_is_space_internal(space_id, org_id) );

alter policy task_pricing_insert_member on public.task_pricing
  with check ( public.app_is_space_internal(space_id, org_id) );

alter policy task_pricing_update_member on public.task_pricing
  using ( public.app_is_space_internal(space_id, org_id) )
  with check ( public.app_is_space_internal(space_id, org_id) );

alter policy task_pricing_delete_member on public.task_pricing
  using ( public.app_is_space_internal(space_id, org_id) );

-- ロールバック（節 5。組織の社内メンバーかどうか（app_is_org_internal）に戻す）:
--   alter policy task_pricing_select_member on public.task_pricing using ( public.app_is_org_internal(org_id) );
--   alter policy task_pricing_insert_member on public.task_pricing with check ( public.app_is_org_internal(org_id) );
--   alter policy task_pricing_update_member on public.task_pricing using ( public.app_is_org_internal(org_id) ) with check ( public.app_is_org_internal(org_id) );
--   alter policy task_pricing_delete_member on public.task_pricing using ( public.app_is_org_internal(org_id) );
-- =============================================================================
-- 節 6: 末尾の確認（何も変えない）… 関数・トリガー・ポリシーが想定どおりで、今の行が規則を満たしている。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_n    bigint;
begin
  -- 作り直した関数: 本 migration の本文・SECURITY DEFINER・search_path = public
  select string_agg(p.proname, ',' order by p.proname collate "C")
    into v_text
    from (values
      ('enforce_space_member_in_org()', 'a09b78e50b94eaef2bb916d9dcd341a0'),
      ('rpc_update_org_member_role(uuid,uuid,text)', '0d54b0e37e0ec3a106631e93ced9b4aa'),
      ('rpc_update_space_member_role(uuid,uuid,text)', '4b1214b97dda33ac8c5faf2376e2be62')
    ) as e(fn, new_md5)
    join pg_proc p on p.oid = to_regprocedure('public.' || e.fn)
   where md5(p.prosrc) = e.new_md5
     and p.prosecdef
     and p.proconfig = array['search_path=public'];
  if v_text is distinct from 'enforce_space_member_in_org,rpc_update_org_member_role,rpc_update_space_member_role' then
    v_bad := v_bad || ' 作り直した関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 実行権: 2つの RPC は authenticated と service_role だけ・トリガー関数2つは誰も実行できない
  select string_agg(format('%s=%s/%s/%s/%s', p.proname,
                           has_function_privilege('public', p.oid, 'execute')::text,
                           has_function_privilege('anon', p.oid, 'execute')::text,
                           has_function_privilege('authenticated', p.oid, 'execute')::text,
                           has_function_privilege('service_role', p.oid, 'execute')::text),
                    ' ' order by p.proname collate "C")
    into v_text
    from pg_proc p
   where p.oid in (to_regprocedure('public.enforce_space_member_in_org()'),
                   to_regprocedure('public.enforce_org_member_role_matches_spaces()'),
                   to_regprocedure('public.rpc_update_org_member_role(uuid,uuid,text)'),
                   to_regprocedure('public.rpc_update_space_member_role(uuid,uuid,text)'));
  if v_text is distinct from
       'enforce_org_member_role_matches_spaces=false/false/false/false '
       'enforce_space_member_in_org=false/false/false/false '
       'rpc_update_org_member_role=false/false/true/true '
       'rpc_update_space_member_role=false/false/true/true' then
    v_bad := v_bad || ' 実行権: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 新しいトリガー関数: SECURITY DEFINER・search_path = public
  select count(*) into v_n
    from pg_proc p
   where p.oid = to_regprocedure('public.enforce_org_member_role_matches_spaces()')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];
  if v_n <> 1 then
    v_bad := v_bad || ' enforce_org_member_role_matches_spaces の形;';
  end if;

  -- トリガー: space_memberships は role の書き換えでも確かめる・org_memberships は遅延の制約トリガー
  select count(*) into v_n
    from pg_trigger t
   where t.tgrelid = 'public.space_memberships'::regclass
     and t.tgname = 'trg_enforce_space_member_in_org'
     and not t.tgisinternal
     and t.tgenabled = 'O'
     and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF space_id, user_id, role ON public.space_memberships FOR EACH ROW%';
  if v_n <> 1 then
    v_bad := v_bad || ' trg_enforce_space_member_in_org の形;';
  end if;

  select count(*) into v_n
    from pg_trigger t
   where t.tgrelid = 'public.org_memberships'::regclass
     and t.tgname = 'trg_org_member_role_matches_spaces'
     and not t.tgisinternal
     and t.tgenabled = 'O'
     and t.tgconstraint <> 0
     and t.tgdeferrable
     and t.tginitdeferred
     and t.tgfoid = to_regprocedure('public.enforce_org_member_role_matches_spaces()')
     and pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF role ON public.org_memberships%FOR EACH ROW%';
  if v_n <> 1 then
    v_bad := v_bad || ' trg_org_member_role_matches_spaces の形;';
  end if;

  -- task_pricing の4ポリシー: 条件は app_is_space_internal(space_id, org_id) だけ
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'task_pricing'
     and policyname in ('task_pricing_select_member', 'task_pricing_insert_member',
                        'task_pricing_update_member', 'task_pricing_delete_member')
     and coalesce(qual, '') not like '%app_is_org_internal%'
     and coalesce(with_check, '') not like '%app_is_org_internal%'
     and (coalesce(qual, '') like '%app_is_space_internal(space_id, org_id)%'
          or coalesce(with_check, '') like '%app_is_space_internal(space_id, org_id)%');
  if v_n <> 4 then
    v_bad := v_bad || format(' task_pricing のポリシー=%s（4 のはず）;', v_n);
  end if;

  -- 今の行: 組織の役割で持てない space の役割の行・組織のメンバーでない space のメンバーが 0
  select count(*) into v_n
    from public.space_memberships sm
    join public.spaces s on s.id = sm.space_id
    left join public.org_memberships om on om.org_id = s.org_id and om.user_id = sm.user_id
   where om.role is null
      or sm.role <> all (case when om.role = 'client' then array['client', 'vendor']
                              else array['admin', 'editor', 'viewer'] end);
  if v_n > 0 then
    v_bad := v_bad || format(' 規則に合わない space のメンバー=%s;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'org space role consistency: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 6）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_org_space_role_consistency.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh（PR-B → 本 migration の順に通る）
--   1) 適用前（本番・読むだけ）: 規則に合わない space のメンバーが 0 件:
--        select count(*) from public.space_memberships sm join public.spaces s on s.id = sm.space_id
--          left join public.org_memberships om on om.org_id = s.org_id and om.user_id = sm.user_id
--         where om.role is null
--            or (om.role = 'client' and sm.role not in ('client', 'vendor'))
--            or (om.role <> 'client' and sm.role not in ('admin', 'editor', 'viewer'));
--      作り直す関数の今の本文が土台と同じ（節 0 の md5）:
--        select p.oid::regprocedure, md5(p.prosrc) from pg_proc p
--         where p.oid in ('public.rpc_update_org_member_role(uuid,uuid,text)'::regprocedure,
--                         'public.rpc_update_space_member_role(uuid,uuid,text)'::regprocedure,
--                         'public.enforce_space_member_in_org()'::regprocedure);
--   2) 適用後（本番）: 節 6 が通る。
--   3) 画面: 組織のメンバー設定で役割を変えると、プロジェクトの役割も一緒にそろう／プロジェクトのメンバー設定で
--      組織の役割に合わない役割を選ぶと断られる／招待を受けてプロジェクトに入れる（社内・相手先・協力会社）／
--      社内のメンバーはタスクの見積を読み書きでき、相手先・協力会社は読めない。
-- =============================================================================

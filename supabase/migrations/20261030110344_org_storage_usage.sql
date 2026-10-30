-- =============================================================================
-- ディスク使用量を数える
--
-- これまで rpc_check_org_limits は使用量を 0 と返していた（「プランと請求」の
-- ストレージ欄が常に 0）。ここで実際の値を返すようにする。
--
-- 節 1: org_storage_usage(p_org_id, p_space_id) … プロジェクトごとのバイト数とファイル数。
--       p_space_id を渡すとそのプロジェクトの行だけを集計する（チャットの添付は出さない）。
--       space_id が null の行はチャット（LINE など）の添付。
--       プロジェクトの分は files.size_bytes（status='ready'）を足す。本番で
--       storage.objects の実サイズと全件一致を確認済み（2026-10-30・78件）。
--       チャットの添付は表が無いので storage.objects のサイズを足す（鍵の先頭が org_id）。
-- 節 2: rpc_check_org_limits の storage.current_bytes を節 1 の合計にする。
--       本文は 20260726190731_billing_quotes.sql と同じ（本番と md5 一致を確認済み）で、
--       v_storage_bytes := 0 の1行だけを置き換える。create or replace なので実行権はそのまま。
--
-- 実行権: org_storage_usage は service_role だけ（API が所属を確かめてから呼ぶ）。
-- 冪等: create or replace / revoke → grant。
-- 可逆: 末尾のロールバック節。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: org_storage_usage
-- =============================================================================

-- 組織ごとの集計で files を全件読まないための索引（files_space_ready_idx は space_id から始まる）
create index if not exists files_org_ready_idx on public.files (org_id) where status = 'ready';

create or replace function public.org_storage_usage(p_org_id uuid, p_space_id uuid default null)
returns table (space_id uuid, bytes bigint, file_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select f.space_id, coalesce(sum(f.size_bytes), 0)::bigint, count(*)::bigint
  from public.files f
  where f.org_id = p_org_id and f.status = 'ready'
    and (p_space_id is null or f.space_id = p_space_id)
  group by f.space_id
  union all
  select null::uuid, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint, count(*)::bigint
  from storage.objects o
  where o.bucket_id = 'channel-attachments'
    and o.name like p_org_id::text || '/%'
    and p_space_id is null
  having count(*) > 0;
$$;

revoke execute on function public.org_storage_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.org_storage_usage(uuid, uuid) to service_role;

do $$
declare
  v_fn constant text := 'public.org_storage_usage(uuid, uuid)';
begin
  if has_function_privilege('public', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'org_storage_usage: 実行権が service_role だけになっていません: %',
      (select p.proacl from pg_proc p where p.oid = v_fn::regprocedure);
  end if;
end $$;


-- =============================================================================
-- 節 2: rpc_check_org_limits の使用量を実際の値にする
-- =============================================================================

create or replace function public.rpc_check_org_limits(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans%rowtype;
  v_projects_count integer;
  v_members_count integer;
  v_clients_count integer;
  v_storage_bytes bigint;
  v_add_members integer := 0;
  v_members_limit integer;
begin
  -- ⚠ record 変数はスカラーと同じ INTO リストに並べられない（実PGでエラー）。
  --   plans.id は org_billing.plan_id と join 済みなので v_plan.id が実効プランID。
  select p.* into v_plan
  from org_billing ob
  join plans p on p.id = ob.plan_id
  where ob.org_id = p_org_id;

  if v_plan.id is null then
    -- No billing record, assume free
    select * into v_plan from plans where id = 'free';
  end if;

  -- 承認済み見積もりの加算（有料プランのときのみ・非負のみ）
  if v_plan.id in ('pro', 'enterprise') then
    select coalesce(sum(add_members), 0) into v_add_members
    from billing_quotes
    where org_id = p_org_id and status = 'approved';
  end if;

  -- limit が null（無制限）なら加算しても無制限のまま
  v_members_limit := case
    when v_plan.members_limit is null then null
    else v_plan.members_limit + v_add_members
  end;

  select count(*) into v_projects_count
  from spaces where org_id = p_org_id and type = 'project';

  select count(*) into v_members_count
  from org_memberships where org_id = p_org_id and role in ('owner', 'member');

  select count(*) into v_clients_count
  from org_memberships where org_id = p_org_id and role = 'client';

  -- ディスク使用量: プロジェクトのファイルとチャットの添付の合計（内訳は org_storage_usage）
  select coalesce(sum(u.bytes), 0)::bigint into v_storage_bytes
  from public.org_storage_usage(p_org_id) u;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'projects', jsonb_build_object(
      'current', v_projects_count,
      'limit', v_plan.projects_limit,
      'can_add', v_plan.projects_limit is null or v_projects_count < v_plan.projects_limit
    ),
    'members', jsonb_build_object(
      'current', v_members_count,
      'limit', v_members_limit,
      'can_add', v_members_limit is null or v_members_count < v_members_limit
    ),
    'clients', jsonb_build_object(
      'current', v_clients_count,
      'limit', v_plan.clients_limit,
      'can_add', v_plan.clients_limit is null or v_clients_count < v_plan.clients_limit
    ),
    'storage', jsonb_build_object(
      'current_bytes', v_storage_bytes,
      'limit_bytes', v_plan.storage_limit_bytes,
      'can_add', v_plan.storage_limit_bytes is null or v_storage_bytes < v_plan.storage_limit_bytes
    )
  );
end;
$$;


-- =============================================================================
-- ロールバック:
--   節 2: 20260726190731_billing_quotes.sql の rpc_check_org_limits をそのまま流し直す
--   節 1: drop function public.org_storage_usage(uuid, uuid); drop index public.files_org_ready_idx;
-- 検証（本番・読むだけ）:
--   select o.id, (public.rpc_check_org_limits(o.id)->'storage'->>'current_bytes')::bigint,
--          (select sum(size_bytes) from files f where f.org_id = o.id and f.status = 'ready')
--   from organizations o;   -- 2列目と3列目が一致（チャットの添付が無い組織）
-- =============================================================================

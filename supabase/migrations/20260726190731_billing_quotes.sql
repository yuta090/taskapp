-- 枠追加の「見積もり → 顧客承認 → 請求反映」フロー（PR1: Stripeには触らない）
-- 設計正本: Fable 裁定 2026-07-26（quote行そのものを唯一の正本にする）
--
-- 流れ: 顧客(owner)が枠追加を依頼 → 当社(superadmin)が金額を提示 → 顧客が承認
--       → 承認と同時に枠が増える（請求への反映は PR2。当面は当社が手動反映）
--
-- 設計上の要点:
--   - **提示後の行は不変**。金額を変えるときは cancel して新しい行を作る（supersede）。
--     ＝「あとで金額が書き換わっていた」が構造的に起きない。
--   - 加算は非負のみ（check）。減枠は負の数ではなく terminated で表現する。
--     ＝ DB障害やクエリ失敗は「加算しない」＝必ず狭い側に倒れる（fail-closed）。
--   - 進行中(requested/offered)の見積もりは org あたり1件（部分ユニーク索引）。
--   - 承認は SECURITY DEFINER RPC のアトミック遷移のみ。二重承認の2回目は false。
--   - RLS: SELECT は org の owner のみ。INSERT/UPDATE/DELETE ポリシーは**作らない**
--     ＝ authenticated からの直接書込は全拒否（書込は全て route(service_role) 経由）。

create table if not exists public.billing_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  status text not null default 'requested'
    check (status in ('requested','offered','approved','rejected','canceled','expired','terminated')),

  -- 依頼（顧客）
  requested_by uuid references auth.users(id),
  requested_note text,
  requested_at timestamptz not null default now(),

  -- 提示（当社）: 金額は月額・税別の円。加算は非負のみ。
  amount_monthly_jpy integer check (amount_monthly_jpy is null or amount_monthly_jpy >= 0),
  add_members integer not null default 0 check (add_members >= 0),
  add_line_groups integer not null default 0 check (add_line_groups >= 0),
  add_external_chat_groups integer not null default 0 check (add_external_chat_groups >= 0),
  offer_note text,
  offered_by uuid references auth.users(id),
  offered_at timestamptz,
  expires_at timestamptz,

  -- 承認/終了
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_at timestamptz,
  canceled_at timestamptz,
  terminated_at timestamptz,

  -- Stripe 反映（PR2 で使う。PR1 では approved 時に 'pending' を積むだけ）
  stripe_price_id text,
  stripe_subscription_item_id text,
  stripe_sync_status text not null default 'n/a'
    check (stripe_sync_status in ('n/a','pending','applied','manual')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_quotes is
  '枠追加の見積もり。依頼→提示→承認の記録そのものが正本（承認済み行の合算が実効上限に加算される）。';

-- 進行中(requested/offered)は org あたり1件だけ（依頼の乱立と、どれを承認したのか不明な状態を防ぐ）
create unique index if not exists billing_quotes_one_open_per_org
  on public.billing_quotes (org_id)
  where status in ('requested','offered');

-- 実効上限の解決（resolveOrgLimits / rpc_check_org_limits）が毎回引くため
create index if not exists billing_quotes_org_status_idx
  on public.billing_quotes (org_id, status);

-- =============================================================================
-- RLS: SELECT は org owner のみ。書込ポリシーは作らない（= service_role 経由のみ）
-- =============================================================================
alter table public.billing_quotes enable row level security;

drop policy if exists billing_quotes_select_owner on public.billing_quotes;
create policy billing_quotes_select_owner
  on public.billing_quotes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_memberships m
      where m.org_id = billing_quotes.org_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- =============================================================================
-- 承認 RPC: status='offered' のアトミック遷移
--   - 期限切れは lazy 判定（cron を作らない）: expires_at を過ぎていたら expired へ落として false
--   - p_amount_echo: 画面に表示されていた金額。行と一致しなければ false（すり替え/古い画面の防止）
--   - 承認者は route がセッションから解決して渡す（クライアント申告は受けない）
-- 戻り値: jsonb { ok, reason }
-- =============================================================================
create or replace function public.rpc_approve_billing_quote(
  p_quote_id uuid,
  p_user_id uuid,
  p_amount_echo integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote billing_quotes%rowtype;
  v_updated integer;
begin
  select * into v_quote from billing_quotes where id = p_quote_id for update;

  if v_quote.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_quote.status <> 'offered' then
    -- 二重承認の2回目・却下済み・取消済みなど
    return jsonb_build_object('ok', false, 'reason', 'not_offered');
  end if;

  if v_quote.expires_at is not null and v_quote.expires_at < now() then
    update billing_quotes
      set status = 'expired', updated_at = now()
      where id = p_quote_id and status = 'offered';
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_quote.amount_monthly_jpy is distinct from p_amount_echo then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  update billing_quotes
    set status = 'approved',
        approved_by = p_user_id,
        approved_at = now(),
        -- PR1 では Stripe に触らない。当社が手動反映するまで pending として管理画面に出す。
        stripe_sync_status = 'pending',
        updated_at = now()
    where id = p_quote_id and status = 'offered';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_offered');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.rpc_approve_billing_quote(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.rpc_approve_billing_quote(uuid, uuid, integer) to service_role;

-- =============================================================================
-- rpc_check_org_limits に承認済み見積もりの加算を反映する
--
-- ⚠ ここを落とすと「画面では枠が増えたのに、招待だけDB側で断られる」という
--   静かな事故になる（人数上限の執行は rpc_create_invite / rpc_accept_invite が
--   この関数の members.can_add を見ているため）。
--   加算は **plan が pro/enterprise のときのみ**（free に落ちたら追加枠は失効する）。
--   本体は 20240103_000_auth_billing.sql の定義に加算 join を足したもの。
-- =============================================================================
create or replace function public.rpc_check_org_limits(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans%rowtype;
  v_plan_id text;
  v_projects_count integer;
  v_members_count integer;
  v_clients_count integer;
  v_storage_bytes bigint;
  v_add_members integer := 0;
  v_members_limit integer;
begin
  select p.*, ob.plan_id into v_plan, v_plan_id
  from org_billing ob
  join plans p on p.id = ob.plan_id
  where ob.org_id = p_org_id;

  if v_plan.id is null then
    -- No billing record, assume free
    select * into v_plan from plans where id = 'free';
    v_plan_id := 'free';
  end if;

  -- 承認済み見積もりの加算（有料プランのときのみ・非負のみ）
  if v_plan_id in ('pro', 'enterprise') then
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

  v_storage_bytes := 0;

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

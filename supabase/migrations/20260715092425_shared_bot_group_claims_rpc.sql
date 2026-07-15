-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 — 手順4 / 承認台帳＋承認RPCファミリ
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §2 / §3 / §4 / §6-4 / §7-8
--
-- 目的: web_approval 経路の共有botグループ紐付けを、会話本文を一切持たない
--   content-free の承認台帳（channel_group_claims）＋ service-role専用の承認RPC
--   ファミリで実現する。channel_groups を作れるのは承認RPCのみ（webhook内アドホック
--   INSERT禁止）。ロック順序 link_codes FOR UPDATE → claim FOR UPDATE を全経路で厳守。
--
-- limbo（未承認グループ）は無保存（設計正本 §4）。ここに残すのは content-free メタのみ
--   （groupId / challenge / 時刻 / state / コードが指すorg・space・グループ表示名スナップショット）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) channel_group_claims — web_approval 専用・content-free 承認台帳
-- -----------------------------------------------------------------------------
create table if not exists public.channel_group_claims (
  id uuid primary key default gen_random_uuid(),
  link_code_id uuid not null references public.channel_link_codes(id) on delete restrict,
  account_id uuid not null references public.channel_accounts(id) on delete restrict,
  external_group_id text not null,
  org_id uuid not null,
  space_id uuid not null,
  -- 承認者がグループを識別する材料（content-free。会話本文ではない）
  challenge_label text,
  -- LINE API から取得したグループ表示名（承認者の確認材料・content-free）
  group_display_name_snapshot text,
  -- 状態: web_approval = pending→approved/rejected/expired。
  --   code_only（PR3実装）= 償還RPCが group INSERT と同一Txで auto_approved 行を記録
  --   （approved_by=null・根拠=bound link_code）。失効/消費済みコード再投入は rejected 行を残す
  --   （code_only は人の承認が無いぶん、試行の観測が唯一の盗難検知面）。
  --   ★auto_approved は pending を経由しない（偽の承認ワークフローを作らない）。
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'auto_approved')),
  approved_by uuid,
  approved_at timestamptz,
  rejected_at timestamptz,
  -- webhook 再送の観測（冪等化の補助・診断）
  events_seen int not null default 0,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references public.spaces(id, org_id) on delete restrict,
  foreign key (org_id) references public.organizations(id) on delete restrict
);

-- webhook 再送の冪等化: 同一(コード, account, グループ)の pending claim は1件のみ。
create unique index if not exists channel_group_claims_pending_unique
  on public.channel_group_claims(link_code_id, account_id, external_group_id)
  where status = 'pending';

-- コンソールの承認待ち一覧（自org の pending）用。
create index if not exists channel_group_claims_org_pending
  on public.channel_group_claims(org_id) where status = 'pending';

comment on table public.channel_group_claims is
  '共有botの全紐付け試行の統一台帳（content-free・会話本文なし）。Fable最終裁定§4: web_approval=pending/approved/rejected/expired、code_only(PR3)=auto_approved（失効消費済み再投入は rejected も記録＝盗難検知面）。レート監視・abuse検知も1表で済む';

-- -----------------------------------------------------------------------------
-- 2) RLS: 読取=内部メンバー（自org の pending を承認するため）。書込ポリシー無し。
-- -----------------------------------------------------------------------------
alter table public.channel_group_claims enable row level security;
revoke all on table public.channel_group_claims from anon, authenticated;
grant select on table public.channel_group_claims to authenticated;

drop policy if exists channel_group_claims_select_internal on public.channel_group_claims;
create policy channel_group_claims_select_internal
  on public.channel_group_claims
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- -----------------------------------------------------------------------------
-- 3) rpc_approve_group_claim — Web承認トランザクション（service role専用）
--    API route が auth.uid をサーバ側解決して p_approver_user_id に渡す前提。
--    クライアント申告の user_id/org_id は信用しない。
--    ロック順序: link_codes 行 FOR UPDATE → claim 行 FOR UPDATE（設計正本 §3 厳守）。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_approve_group_claim(
  p_claim_id uuid,
  p_approver_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link_code_id uuid;
  v_lc record;
  v_claim record;
begin
  -- ロック順序を確定するため、まず claim から link_code_id だけを軽く読む（ロック取得はしない）。
  select link_code_id into v_link_code_id
  from public.channel_group_claims
  where id = p_claim_id;

  if v_link_code_id is null then
    raise exception 'rpc_approve_group_claim: unknown claim_id %', p_claim_id;
  end if;

  -- (1) link_codes 行を FOR UPDATE で先に掴む。
  --     ★code を単一の真実源にする（設計正本 §3/§7-8「紐付け先は常に code.org_id/space_id のみ」）。
  --       org_id/space_id もここから取り、INSERT・membership 検証に用いる。
  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, org_id, space_id
    into v_lc
  from public.channel_link_codes
  where id = v_link_code_id
  for update;

  -- (2) 次に claim 行を FOR UPDATE。
  select id, link_code_id, account_id, external_group_id, org_id, space_id,
         group_display_name_snapshot, status
    into v_claim
  from public.channel_group_claims
  where id = p_claim_id
  for update;

  -- 再検証（いずれか失敗で拒否）。
  if v_claim.status is distinct from 'pending' then
    raise exception 'rpc_approve_group_claim: claim % is not pending (status=%)', p_claim_id, v_claim.status;
  end if;
  if v_lc.purpose is distinct from 'shared_group_claim' then
    raise exception 'rpc_approve_group_claim: link_code purpose must be shared_group_claim (got %)', v_lc.purpose;
  end if;
  if v_lc.binding_mode is distinct from 'web_approval' then
    raise exception 'rpc_approve_group_claim: link_code binding_mode must be web_approval (got %)', v_lc.binding_mode;
  end if;
  if v_lc.consumed_at is not null then
    raise exception 'rpc_approve_group_claim: link_code already consumed';
  end if;
  if v_lc.expires_at <= now() then
    raise exception 'rpc_approve_group_claim: link_code expired';
  end if;
  if v_lc.target_account_id is distinct from v_claim.account_id then
    raise exception 'rpc_approve_group_claim: link_code target_account_id does not match claim account';
  end if;

  -- ★C1: claim と code の org/space 乖離を大声で検出する。
  --   claim は PR2 の別 service-role コードが作るため、そこにバグ/侵害があれば
  --   victim org のコードを消費して attacker org にグループが渡り得る。
  --   コードを単一の真実源にし、乖離は fail-closed で拒否する。
  if v_claim.org_id is distinct from v_lc.org_id
     or v_claim.space_id is distinct from v_lc.space_id then
    raise exception 'rpc_approve_group_claim: claim org/space (%/%) does not match link_code (%/%)',
      v_claim.org_id, v_claim.space_id, v_lc.org_id, v_lc.space_id;
  end if;

  -- 承認者が code.org_id の内部メンバー（owner/admin/member）であること。
  -- ★紐付け先 org は常に code 由来（v_lc.org_id）。claim.org には依存しない。
  -- ★app_is_org_internal は auth.uid() ベースで service definer 内では使えないため、
  --   明示的に p_approver_user_id で org_memberships を直接引く（RLSはdefinerでバイパス）。
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_lc.org_id
      and m.user_id = p_approver_user_id
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'rpc_approve_group_claim: approver % is not an internal member of org %', p_approver_user_id, v_lc.org_id;
  end if;

  -- 新世代グループを作成（org/space は ★code 由来。A-1 トリガーが整合を再検証する）。
  -- 同一グループへの2claim同時承認は channel_groups_active_unique が最終審判。
  -- 敗者の 23505 は graceful reject（リトライしない）。
  begin
    insert into public.channel_groups (
      org_id, space_id, account_id, channel, external_group_id,
      display_name, status, tenant_source, bound_by_link_code_id
    ) values (
      v_lc.org_id, v_lc.space_id, v_claim.account_id, 'line', v_claim.external_group_id,
      v_claim.group_display_name_snapshot, 'active', 'approved_link_code', v_lc.id
    );
  exception when unique_violation then
    -- 既にこのグループは active 世代が存在する（別claim が先に成立）。
    -- コードは消費せず、この claim を却下扱いで pending から外す。
    update public.channel_group_claims
    set status = 'rejected', rejected_at = now()
    where id = p_claim_id;
    return false;
  end;

  -- コード消費（単回成功）。
  update public.channel_link_codes
  set consumed_at = now()
  where id = v_lc.id;

  -- claim を承認確定。
  update public.channel_group_claims
  set status = 'approved', approved_by = p_approver_user_id, approved_at = now()
  where id = p_claim_id;

  return true;
end;
$$;

revoke execute on function public.rpc_approve_group_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_approve_group_claim(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4) rpc_reject_group_claim — 承認者による却下（service role専用）
--    membership を確認の上 pending → rejected。link_codes は消費しない。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_reject_group_claim(
  p_claim_id uuid,
  p_approver_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim record;
  v_updated int;
begin
  select id, org_id, status into v_claim
  from public.channel_group_claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then
    raise exception 'rpc_reject_group_claim: unknown claim_id %', p_claim_id;
  end if;

  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_claim.org_id
      and m.user_id = p_approver_user_id
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'rpc_reject_group_claim: approver % is not an internal member of org %', p_approver_user_id, v_claim.org_id;
  end if;

  update public.channel_group_claims
  set status = 'rejected', rejected_at = now()
  where id = p_claim_id
    and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.rpc_reject_group_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_reject_group_claim(uuid, uuid) to service_role;

-- =============================================================================
-- 検証（適用後に service role で実施。設計正本 §8 (e)(f)(g)。全ケースを
--   supabase/tests/shared_bot_tenancy_verify.sql が使い捨てクラスタで自動検証済み）:
--   (e) 承認者が code.org のメンバーでない（他org member 含む）承認RPCが拒否される。
--   (f) 失効(expires_at<=now)/消費済み(consumed_at not null)コードの承認が拒否される。
--   (g) 同一グループへの2claim同時承認 → 片方が channel_groups_active_unique の 23505 で
--       graceful に false（かつ当該 claim は rejected へ）・もう片方が true。デッドロック無し。
--   (C1) claim.org/space ≠ code.org/space の承認が拒否される（code を単一の真実源に）。
--   + purpose≠shared_group_claim / binding_mode≠web_approval の拒否。
--   + target_account_id ≠ claim.account_id の拒否。
--   + 承認成功で channel_groups(org/space は★code由来, tenant_source=approved_link_code,
--     bound_by_link_code_id) が1行、link_code.consumed_at が埋まり、claim.status=approved になること。
--   + RLS: 他org の authenticated から channel_group_claims が 0行、自org は読めること。
-- ロールバック:
--   drop function public.rpc_reject_group_claim(uuid, uuid);
--   drop function public.rpc_approve_group_claim(uuid, uuid);
--   drop table public.channel_group_claims;   -- (approved 済みが作った channel_groups 行は残る＝証跡)
-- =============================================================================

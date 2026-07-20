-- =============================================================================
-- 相手先グループ容量上限を DB 層でアトミックに強制する（Fable裁定オプションB）
--
-- 背景（TOCTOUレース）:
--   容量上限（maxLineGroups / maxExternalChatGroups）はアプリ層の read→act で判定していた
--   （approval route / discord ingest handler が数えてから確立）。並行 approve/redeem で
--   上限を N 件超過し得る。「既存は絶対に切らない」契約ゆえ、漏れた超過グループは事後切除
--   できず 1 件ごとが不可逆。code_only 経路は外部起点（相手先のコード投入）で人間ペースに
--   律速されず、org が枠超のコードを並列償還すれば恒久超過が誘発可能。→ DB 層で閉じる。
--
-- 設計（Fable裁定B・後方互換）:
--   両 RPC に `p_max_active_groups int default null` を追加。**NULL = 無制限 = 現行挙動**
--   （アプリが渡し始めるまで挙動不変・ロールバックは RPC 再定義のみ＝可逆）。
--   確立INSERTの直前に advisory xact lock を (org_id, channel) 単位で取り、同一ロック下で
--   active 数を数え、上限到達なら errcode 'GC402' で raise（既存 active は一切触らない）。
--   カウント区分はアプリの soft-check と厳密一致させる: `channel = <account由来channel>` で数える
--   （orgLineGroupCapacity は channel='line' / orgExternalChatGroupCapacity は channel=当該 を数える）。
--
--   ★導出・ロック順序・disabled凍結・再検証群・graceful reject・戻り値・他 errcode は
--     20260720164122（現行正本）を完全踏襲。追加は「引数・advisory lock・count・GC402」のみ。
--
--   overload 回避のため旧シグネチャを drop してから新シグネチャを作る
--   （2引数/4引数のまま残すと default 付き新関数と曖昧になるため）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) rpc_approve_group_claim(uuid, uuid) → (uuid, uuid, int default null)
-- -----------------------------------------------------------------------------
drop function if exists public.rpc_approve_group_claim(uuid, uuid);

create or replace function public.rpc_approve_group_claim(
  p_claim_id uuid,
  p_approver_user_id uuid,
  p_max_active_groups int default null
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
  v_constraint text;
  v_channel text;
begin
  select link_code_id into v_link_code_id
  from public.channel_group_claims
  where id = p_claim_id;

  if v_link_code_id is null then
    raise exception 'rpc_approve_group_claim: unknown claim_id %', p_claim_id
      using errcode = 'GC404';
  end if;

  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, revoked_at, org_id, space_id
    into v_lc
  from public.channel_link_codes
  where id = v_link_code_id
  for update;

  select id, link_code_id, account_id, external_group_id, org_id, space_id,
         group_display_name_snapshot, status
    into v_claim
  from public.channel_group_claims
  where id = p_claim_id
  for update;

  if v_claim.link_code_id is distinct from v_lc.id then
    raise exception 'rpc_approve_group_claim: claim link_code_id changed under lock (TOCTOU): % <> %',
      v_claim.link_code_id, v_lc.id
      using errcode = 'GC409';
  end if;

  if v_claim.status is distinct from 'pending' then
    raise exception 'rpc_approve_group_claim: claim % is not pending (status=%)', p_claim_id, v_claim.status
      using errcode = 'GC409';
  end if;
  if v_lc.purpose is distinct from 'shared_group_claim' then
    raise exception 'rpc_approve_group_claim: link_code purpose must be shared_group_claim (got %)', v_lc.purpose
      using errcode = 'GC422';
  end if;
  if v_lc.binding_mode is distinct from 'web_approval' then
    raise exception 'rpc_approve_group_claim: link_code binding_mode must be web_approval (got %)', v_lc.binding_mode
      using errcode = 'GC422';
  end if;
  if v_lc.consumed_at is not null then
    raise exception 'rpc_approve_group_claim: link_code already consumed'
      using errcode = 'GC409';
  end if;
  if v_lc.revoked_at is not null then
    raise exception 'rpc_approve_group_claim: link_code has been revoked'
      using errcode = 'GC422';
  end if;
  if v_lc.expires_at <= now() then
    raise exception 'rpc_approve_group_claim: link_code expired'
      using errcode = 'GC422';
  end if;
  if v_lc.target_account_id is distinct from v_claim.account_id then
    raise exception 'rpc_approve_group_claim: link_code target_account_id does not match claim account'
      using errcode = 'GC422';
  end if;

  if v_claim.org_id is distinct from v_lc.org_id
     or v_claim.space_id is distinct from v_lc.space_id then
    raise exception 'rpc_approve_group_claim: claim org/space (%/%) does not match link_code (%/%)',
      v_claim.org_id, v_claim.space_id, v_lc.org_id, v_lc.space_id
      using errcode = 'GC422';
  end if;

  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_lc.org_id
      and m.user_id = p_approver_user_id
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'rpc_approve_group_claim: approver % is not an internal member of org %', p_approver_user_id, v_lc.org_id
      using errcode = 'GC403';
  end if;

  if not exists (
    select 1 from public.channel_accounts a
    where a.id = v_claim.account_id
      and a.status = 'active'
  ) then
    raise exception 'rpc_approve_group_claim: target account is not active (disabled)'
      using errcode = 'GC409';
  end if;

  -- channel を account から導出（20260720164122 と同一）。
  select channel into v_channel
  from public.channel_accounts
  where id = v_claim.account_id;

  -- ★容量アトミック強制（p_max_active_groups が渡された時のみ・NULL=無制限=現行挙動）。
  --   (org, channel) 単位の advisory xact lock を取り、同一ロック下で active 数を数える。
  --   カウント区分はアプリの soft-check と厳密一致（channel = v_channel で数える）。
  --   既存 active は一切触らず、上限到達なら新規確立のみ GC402 で拒否する。
  if p_max_active_groups is not null then
    perform pg_advisory_xact_lock(hashtext('cgroups_cap:' || v_lc.org_id::text || ':' || v_channel));
    if (
      select count(*) from public.channel_groups g
      where g.org_id = v_lc.org_id
        and g.channel = v_channel
        and g.status = 'active'
    ) >= p_max_active_groups then
      raise exception 'rpc_approve_group_claim: active group capacity reached (max %)', p_max_active_groups
        using errcode = 'GC402';
    end if;
  end if;

  begin
    insert into public.channel_groups (
      org_id, space_id, account_id, channel, external_group_id,
      display_name, status, tenant_source, bound_by_link_code_id
    ) values (
      v_lc.org_id, v_lc.space_id, v_claim.account_id, v_channel, v_claim.external_group_id,
      v_claim.group_display_name_snapshot, 'active', 'approved_link_code', v_lc.id
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'channel_groups_active_unique' then
      raise;
    end if;
    update public.channel_group_claims
    set status = 'rejected', rejected_at = now()
    where id = p_claim_id;
    return false;
  end;

  update public.channel_link_codes
  set consumed_at = now()
  where id = v_lc.id;

  update public.channel_group_claims
  set status = 'approved', approved_by = p_approver_user_id, approved_at = now()
  where id = p_claim_id;

  return true;
end;
$$;

revoke execute on function public.rpc_approve_group_claim(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.rpc_approve_group_claim(uuid, uuid, int) to service_role;

-- -----------------------------------------------------------------------------
-- 2) rpc_redeem_code_only_claim(text, uuid, text, text) → (..., int default null)
-- -----------------------------------------------------------------------------
drop function if exists public.rpc_redeem_code_only_claim(text, uuid, text, text);

create or replace function public.rpc_redeem_code_only_claim(
  p_code_hash text,
  p_account_id uuid,
  p_external_group_id text,
  p_group_display_name text,
  p_max_active_groups int default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lc record;
  v_constraint text;
  v_reject_reason text;
  v_channel text;
begin
  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, revoked_at, org_id, space_id
    into v_lc
  from public.channel_link_codes
  where code_hash = p_code_hash
    and purpose = 'shared_group_claim'
  for update;

  if v_lc.id is null then
    raise exception 'rpc_redeem_code_only_claim: no matching link code for supplied hash'
      using errcode = 'GC404';
  end if;

  if not exists (
    select 1 from public.channel_accounts a
    where a.id = p_account_id
      and a.status = 'active'
  ) then
    raise exception 'rpc_redeem_code_only_claim: target account is not active (disabled)'
      using errcode = 'GC409';
  end if;

  if v_lc.purpose is distinct from 'shared_group_claim' then
    v_reject_reason := 'wrong_purpose';
  elsif v_lc.binding_mode is distinct from 'code_only' then
    v_reject_reason := 'wrong_binding_mode';
  elsif v_lc.consumed_at is not null then
    v_reject_reason := 'consumed';
  elsif v_lc.revoked_at is not null then
    v_reject_reason := 'revoked';
  elsif v_lc.expires_at <= now() then
    v_reject_reason := 'expired';
  elsif v_lc.target_account_id is distinct from p_account_id then
    v_reject_reason := 'wrong_account';
  else
    v_reject_reason := null;
  end if;

  if v_reject_reason is not null then
    insert into public.channel_group_claims (
      link_code_id, account_id, external_group_id, org_id, space_id,
      group_display_name_snapshot, challenge_label, status, rejected_at,
      events_seen, last_event_at
    ) values (
      v_lc.id, p_account_id, p_external_group_id, v_lc.org_id, v_lc.space_id,
      p_group_display_name, v_reject_reason, 'rejected', now(),
      1, now()
    )
    on conflict (link_code_id, account_id, external_group_id) where status = 'rejected'
    do update set
      events_seen = channel_group_claims.events_seen + 1,
      last_event_at = now(),
      challenge_label = excluded.challenge_label;
    return 'rejected';
  end if;

  -- channel を account から導出（20260720164122 と同一）。
  select channel into v_channel
  from public.channel_accounts
  where id = p_account_id;

  -- ★容量アトミック強制（approve と同一機構・NULL=無制限=現行挙動）。
  --   成功確立の直前・rejected 記録より後（rejected は台帳上「無効コード」であり容量に数えない）。
  if p_max_active_groups is not null then
    perform pg_advisory_xact_lock(hashtext('cgroups_cap:' || v_lc.org_id::text || ':' || v_channel));
    if (
      select count(*) from public.channel_groups g
      where g.org_id = v_lc.org_id
        and g.channel = v_channel
        and g.status = 'active'
    ) >= p_max_active_groups then
      raise exception 'rpc_redeem_code_only_claim: active group capacity reached (max %)', p_max_active_groups
        using errcode = 'GC402';
    end if;
  end if;

  begin
    insert into public.channel_groups (
      org_id, space_id, account_id, channel, external_group_id,
      display_name, status, tenant_source, bound_by_link_code_id
    ) values (
      v_lc.org_id, v_lc.space_id, p_account_id, v_channel, p_external_group_id,
      p_group_display_name, 'active', 'code_only_link', v_lc.id
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'channel_groups_active_unique' then
      raise;
    end if;
    return 'already_linked';
  end;

  insert into public.channel_group_claims (
    link_code_id, account_id, external_group_id, org_id, space_id,
    group_display_name_snapshot, status
  ) values (
    v_lc.id, p_account_id, p_external_group_id, v_lc.org_id, v_lc.space_id,
    p_group_display_name, 'auto_approved'
  );

  update public.channel_link_codes
  set consumed_at = now()
  where id = v_lc.id;

  return 'linked';
end;
$$;

revoke execute on function public.rpc_redeem_code_only_claim(text, uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.rpc_redeem_code_only_claim(text, uuid, text, text, int) to service_role;

-- =============================================================================
-- SQLSTATE(errcode) 追加分
--   GC402 | 402 | capacity reached | approve/redeem: active 数が p_max_active_groups 到達（新規確立のみ拒否）
--   ※ p_max_active_groups=NULL では発生しない（無制限＝現行挙動）。既存 active は不変。
-- =============================================================================

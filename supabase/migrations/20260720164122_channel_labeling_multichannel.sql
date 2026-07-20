-- =============================================================================
-- channel_groups の channel を「共有bot claim パイプライン全体」で正しくラベリングする
--   （マルチチャネル共有bot: LINE 以外に Discord 等を載せるための前段是正・Fable裁定）
--
-- 背景（重大欠陥）:
--   共有bot の紐付け確立経路（rpc_approve_group_claim / rpc_redeem_code_only_claim）が
--   channel_groups.channel を 'line' リテラルで固定していた。Discord 等の platform account
--   に対して確立しても行は channel='line' とラベルされ、
--     - orgExternalChatGroupCapacity(channel='discord') が常に 0 → maxExternalChatGroups が
--       絶対に発火しない（Pro 課金/上限バイパス）
--     - 同時に LINE 枠(orgLineGroupCapacity)を汚染
--   となる。CHECK 制約側は channel を広げていたが writer が半分だけ未移行だった穴。
--
-- 是正（本 migration は SQL 層。アプリ層は同PRの route/store 変更が対をなす）:
--   (1) rpc_approve_group_claim: INSERT する channel を account から導出（'line' 固定を廃止）
--   (2) rpc_redeem_code_only_claim: 同上
--   (3) channel_groups_tenant_integrity(): group.channel == account.channel を構造的に強制
--       （どの service-role 経路が INSERT しても channel ラベルの正しさを保証する最後の網）
--   (4) 冪等リペア: 既存の channel≠account.channel を account 由来に是正（本番では 0 行想定）
--
-- ★不変: 導出以外のロジック（ロック順序・再検証群・disabled凍結・graceful reject・戻り値・
--   errcode・claim insert-integrity）は 20260716122144 と完全に踏襲する。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) rpc_approve_group_claim — INSERT の channel を account から導出（他は 20260716122144 と不変）
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
  v_constraint text;
  v_channel text;
begin
  -- ロック順序を確定するため、まず claim から link_code_id だけを軽く読む（ロック取得はしない）。
  select link_code_id into v_link_code_id
  from public.channel_group_claims
  where id = p_claim_id;

  if v_link_code_id is null then
    raise exception 'rpc_approve_group_claim: unknown claim_id %', p_claim_id
      using errcode = 'GC404';
  end if;

  -- (1) link_codes 行を FOR UPDATE で先に掴む（★code を単一の真実源にする・設計正本 §3/§7-8）。
  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, revoked_at, org_id, space_id
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

  -- ★TOCTOU 再検証（結合列 immutable ガードとの二重防御・設計正本 §3）。
  if v_claim.link_code_id is distinct from v_lc.id then
    raise exception 'rpc_approve_group_claim: claim link_code_id changed under lock (TOCTOU): % <> %',
      v_claim.link_code_id, v_lc.id
      using errcode = 'GC409';
  end if;

  -- 再検証（いずれか失敗で拒否）。
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

  -- ★C1: claim と code の org/space 乖離を fail-closed で拒否（コードを単一の真実源に）。
  if v_claim.org_id is distinct from v_lc.org_id
     or v_claim.space_id is distinct from v_lc.space_id then
    raise exception 'rpc_approve_group_claim: claim org/space (%/%) does not match link_code (%/%)',
      v_claim.org_id, v_claim.space_id, v_lc.org_id, v_lc.space_id
      using errcode = 'GC422';
  end if;

  -- 承認者が code.org_id の内部メンバー（owner/admin/member）であること。
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_lc.org_id
      and m.user_id = p_approver_user_id
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'rpc_approve_group_claim: approver % is not an internal member of org %', p_approver_user_id, v_lc.org_id
      using errcode = 'GC403';
  end if;

  -- ★共有bot disabled 凍結（Fable裁定 §6）: 対象 account が active でなければ承認を凍結する。
  if not exists (
    select 1 from public.channel_accounts a
    where a.id = v_claim.account_id
      and a.status = 'active'
  ) then
    raise exception 'rpc_approve_group_claim: target account is not active (disabled)'
      using errcode = 'GC409';
  end if;

  -- ★channel を account から導出する（'line' 固定を廃止）。マルチチャネル共有botの正しいラベリング。
  --   account は上のガードで存在＆active を確認済み。A-1 トリガーが group.channel==account.channel を再検証する。
  select channel into v_channel
  from public.channel_accounts
  where id = v_claim.account_id;

  -- 新世代グループを作成（org/space は ★code 由来・channel は ★account 由来）。
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
    -- 既に active 世代が存在（別claim が先に成立）。コード未消費・この claim を却下扱いに。
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
-- 2) rpc_redeem_code_only_claim — INSERT の channel を account から導出（他は 20260716122144 と不変）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_redeem_code_only_claim(
  p_code_hash text,
  p_account_id uuid,
  p_external_group_id text,
  p_group_display_name text
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
  -- (1) code_hash でコードを引き FOR UPDATE（purpose='shared_group_claim' 限定）。
  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, revoked_at, org_id, space_id
    into v_lc
  from public.channel_link_codes
  where code_hash = p_code_hash
    and purpose = 'shared_group_claim'
  for update;

  -- not-found: 記録対象が無い（コード不一致では rejected claim を作らない）。GC404 で raise。
  if v_lc.id is null then
    raise exception 'rpc_redeem_code_only_claim: no matching link code for supplied hash'
      using errcode = 'GC404';
  end if;

  -- ★共有bot disabled 凍結（Fable裁定 §6・多重防御）: 対象 account が active でなければ即凍結。
  if not exists (
    select 1 from public.channel_accounts a
    where a.id = p_account_id
      and a.status = 'active'
  ) then
    raise exception 'rpc_redeem_code_only_claim: target account is not active (disabled)'
      using errcode = 'GC409';
  end if;

  -- (2) 検証。1つでも外れたら「マッチした無効コード」＝content-free rejected claim を記録して return 'rejected'。
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

  -- ★channel を account から導出する（'line' 固定を廃止）。account は上で active を確認済み。
  select channel into v_channel
  from public.channel_accounts
  where id = p_account_id;

  -- (3) 成功パス: 新世代グループを INSERT（org/space/bound は★code 由来・channel は★account 由来）。
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

  -- (4) 同一Txで auto_approved claim を記録（approved_by=null・根拠=bound link_code）。
  insert into public.channel_group_claims (
    link_code_id, account_id, external_group_id, org_id, space_id,
    group_display_name_snapshot, status
  ) values (
    v_lc.id, p_account_id, p_external_group_id, v_lc.org_id, v_lc.space_id,
    p_group_display_name, 'auto_approved'
  );

  -- (5) コード消費（単回成功・一方向）。
  update public.channel_link_codes
  set consumed_at = now()
  where id = v_lc.id;

  return 'linked';
end;
$$;

revoke execute on function public.rpc_redeem_code_only_claim(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_redeem_code_only_claim(text, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3) channel_groups_tenant_integrity() — group.channel == account.channel を構造的に強制
--    （20260715092423 の定義に channel 整合の1チェックを追加。他は不変）
-- -----------------------------------------------------------------------------
create or replace function public.channel_groups_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_type text;
  v_account_org uuid;
  v_account_channel text;
  v_lc record;
  v_expected_binding_mode text;
begin
  select owner_type, org_id, channel
    into v_owner_type, v_account_org, v_account_channel
  from public.channel_accounts
  where id = new.account_id;

  if v_owner_type is null then
    raise exception 'channel_groups: unknown account_id % (account not found)', new.account_id;
  end if;

  -- ★channel 整合（全 owner_type 共通）: group の channel は必ず account の channel に一致する。
  --   どの service-role 経路（web_approval / code_only / org-owned join）が INSERT しても
  --   channel ラベルの正しさ（容量/エンタイトルメント判定の前提）を構造的に保証する。
  if new.channel is distinct from v_account_channel then
    raise exception 'channel_groups: channel (%) must equal owner account channel (%)',
      new.channel, v_account_channel;
  end if;

  if v_owner_type = 'org' then
    if new.tenant_source is distinct from 'account_owner' then
      raise exception 'channel_groups: owner_type=org requires tenant_source=account_owner (got %)', new.tenant_source;
    end if;
    if new.org_id is distinct from v_account_org then
      raise exception 'channel_groups: org_id (%) must equal owner account org (%)', new.org_id, v_account_org;
    end if;
  elsif v_owner_type = 'platform' then
    if new.tenant_source not in ('approved_link_code', 'code_only_link') then
      raise exception 'channel_groups: owner_type=platform requires tenant_source in (approved_link_code, code_only_link) (got %)', new.tenant_source;
    end if;
    if new.org_id is null then
      raise exception 'channel_groups: platform group requires org_id (NOT NULL) at creation';
    end if;
    if new.space_id is null then
      raise exception 'channel_groups: platform group requires space_id (NOT NULL) at creation';
    end if;
    if new.bound_by_link_code_id is null then
      raise exception 'channel_groups: platform group requires bound_by_link_code_id (NOT NULL) at creation';
    end if;

    select purpose, binding_mode, target_account_id, org_id, space_id
      into v_lc
    from public.channel_link_codes
    where id = new.bound_by_link_code_id;

    if v_lc.purpose is null then
      raise exception 'channel_groups: bound_by_link_code_id % not found', new.bound_by_link_code_id;
    end if;
    if v_lc.purpose is distinct from 'shared_group_claim' then
      raise exception 'channel_groups: bound link_code purpose must be shared_group_claim (got %)', v_lc.purpose;
    end if;
    if v_lc.target_account_id is distinct from new.account_id then
      raise exception 'channel_groups: bound link_code target_account_id does not match group account_id';
    end if;
    if v_lc.org_id is distinct from new.org_id then
      raise exception 'channel_groups: group org_id (%) must equal bound link_code org_id (%)', new.org_id, v_lc.org_id;
    end if;
    if v_lc.space_id is distinct from new.space_id then
      raise exception 'channel_groups: group space_id (%) must equal bound link_code space_id (%)', new.space_id, v_lc.space_id;
    end if;
    v_expected_binding_mode := case new.tenant_source
                                 when 'approved_link_code' then 'web_approval'
                                 when 'code_only_link' then 'code_only'
                               end;
    if v_lc.binding_mode is distinct from v_expected_binding_mode then
      raise exception 'channel_groups: tenant_source % requires bound link_code binding_mode % (got %)',
        new.tenant_source, v_expected_binding_mode, v_lc.binding_mode;
    end if;
  else
    raise exception 'channel_groups: unexpected account owner_type %', v_owner_type;
  end if;

  return new;
end;
$$;

revoke all on function public.channel_groups_tenant_integrity() from public, anon, authenticated;

drop trigger if exists trg_channel_groups_tenant_integrity on public.channel_groups;
create trigger trg_channel_groups_tenant_integrity
  before insert on public.channel_groups
  for each row execute function public.channel_groups_tenant_integrity();

-- -----------------------------------------------------------------------------
-- 4) 冪等リペア: 既存の channel≠account.channel を account 由来に是正する。
--    本番では Discord 等の platform account がまだ無い／既存は全て LINE なので 0 行想定。
--    先に 'line' 固定でラベルされた行があれば正しい channel へ寄せる（安全・前方のみ）。
--    UPDATE は BEFORE INSERT トリガーを発火しないため上の整合トリガーとは干渉しない。
-- -----------------------------------------------------------------------------
update public.channel_groups g
set channel = a.channel
from public.channel_accounts a
where g.account_id = a.id
  and g.channel is distinct from a.channel;

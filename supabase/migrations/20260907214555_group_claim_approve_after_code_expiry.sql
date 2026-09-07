-- 合言葉（channel_link_codes）の期限切れ後でも、期限内に投稿された claim は承認できるようにする
--
-- 変更点は rpc_approve_group_claim の1判定のみ:
--   旧: link_code.expires_at <= now() なら拒否（承認の時刻で判定）
--   新: claim.created_at > link_code.expires_at なら拒否（投稿の時刻で判定）
-- それ以外（ロック順序・TOCTOU・容量アトミック強制・consumed/revoked・org/space 整合・承認者の所属）は
-- 20260720194311_group_capacity_atomic_hardlimit.sql と同一。
--
-- 背景: 30分は「合言葉を投稿できる期間」。投稿（償還→pending claim 作成）後に社内で承認する時刻まで
-- 縛ると、承認が30分以内に間に合わない運用で必ず失敗し、一覧に残り続ける（本番で再現・2026-09-07）。
-- 期限後の承認を許しても、コードは承認時に consumed_at が立ち再利用不能。pending のまま放置された claim は
-- 却下で閉じられる。

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
         group_display_name_snapshot, status, created_at
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
  -- ★合言葉の期限（30分）は「投稿できる期間」であって「承認できる期間」ではない。
  --   claim は投稿時点（償還時）に作られるので、claim.created_at が期限内なら承認は後からでもよい。
  --   以前は now() で判定していたため、投稿後30分を過ぎてから「承認」を押すと必ず失敗し、
  --   一覧から消えず、合言葉を出し直す以外に手が無かった。
  if v_claim.created_at > v_lc.expires_at then
    raise exception 'rpc_approve_group_claim: claim was created after link_code expiry'
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

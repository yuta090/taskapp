-- =============================================================================
-- 共有bot disabled 凍結（Fable裁定 §6）の境界検証（単一セッション）
-- 前提: baseline_stubs.sql → 実 prior migration → 20260715092422〜092426 →
--   20260716111033_shared_bot_code_only_redeem.sql →
--   20260716122144_shared_bot_disabled_freeze_rpc.sql を verbatim 適用済みの使い捨てクラスタ。
-- 実行は run_shared_bot_disabled_freeze.sh（スキーマは作らない・手コピー禁止）。
--
-- 検証:
--   [approve disabled] disabled account の pending claim を approve → GC409・group 未作成・
--     claim は pending のまま・code 未消費（web_approval 裏口封鎖）。
--   [redeem disabled]  disabled account への redeem → GC409・group/claims/consumed いずれも不変
--     （rejected 記録も残さない＝コード非消費・Fable §6）。
--   [退行なし] active account の approve → approved・group 作成、redeem → linked。
-- =============================================================================
set client_min_messages = notice;

create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, got; end if;
end $$;

create or replace function assert_sqlstate(label text, p_sql text, want_state text) returns void
language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state is distinct from want_state then
      raise exception 'FAIL[%]: got sqlstate % (%), want %', label, v_state, v_msg, want_state;
    end if;
    raise notice 'PASS[%]: sqlstate=% msg="%"', label, v_state, v_msg;
    return;
  end;
  raise exception 'FAIL[%]: expected error % but statement succeeded', label, want_state;
end $$;

-- ---- fixtures ---------------------------------------------------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000a1');
insert into spaces values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','S1');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','member');

-- platform account 2つ: fa=active（退行確認用）/ fd=disabled（凍結対象）
insert into channel_accounts(id, owner_type, org_id, channel, display_name, credentials_encrypted, status)
  values ('00000000-0000-0000-0000-0000000000fa','platform',null,'line','agentpm秘書(active)','x','active');
insert into channel_accounts(id, owner_type, org_id, channel, display_name, credentials_encrypted, status)
  values ('00000000-0000-0000-0000-0000000000fd','platform',null,'line','agentpm秘書(disabled)','x','disabled');

-- codes: web_approval（approve 経路）× {disabled, active}、code_only（redeem 経路）× {disabled, active}
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at) values
 -- web_approval → disabled account（approve で GC409 になるべき）
 ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000fd','wd1', now()+interval '20 min'),
 -- web_approval → active account（approve 退行確認・成功すべき）
 ('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000fa','wa2', now()+interval '20 min'),
 -- code_only → disabled account（redeem で GC409 になるべき）
 ('00000000-0000-0000-0000-000000000703','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000fd','dd3', now()+interval '7 day'),
 -- code_only → active account（redeem 退行確認・linked すべき）
 ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000fa','aa4', now()+interval '7 day');

-- web_approval の pending claim（account は各 code の target と一致させる＝target_account 検証を通す）
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id) values
 ('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000000fd','GDIS','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1'),
 ('00000000-0000-0000-0000-000000000802','00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-0000000000fa','GACT','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');

-- =============================================================================
-- 1) approve: disabled account の claim → GC409（裏口封鎖）＋副作用なし
-- =============================================================================
select assert_sqlstate('approve_disabled_gc409', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-0000000000c1')
$q$, 'GC409');
select assert_eq('approve_disabled_no_group',
  (select count(*)::int from channel_groups where external_group_id='GDIS'), 0);
select assert_eq('approve_disabled_claim_still_pending',
  (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000801'), 'pending');
select assert_eq('approve_disabled_code_not_consumed',
  (select consumed_at is null from channel_link_codes where id='00000000-0000-0000-0000-000000000701'), true);

-- =============================================================================
-- 2) redeem: disabled account → GC409＋group/claims/consumed いずれも不変（記録も残さない）
-- =============================================================================
select assert_sqlstate('redeem_disabled_gc409', $q$
  select rpc_redeem_code_only_claim('dd3','00000000-0000-0000-0000-0000000000fd','GRD','G')
$q$, 'GC409');
select assert_eq('redeem_disabled_no_group',
  (select count(*)::int from channel_groups where external_group_id='GRD'), 0);
select assert_eq('redeem_disabled_no_claim',
  (select count(*)::int from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000703'), 0);
select assert_eq('redeem_disabled_code_not_consumed',
  (select consumed_at is null from channel_link_codes where id='00000000-0000-0000-0000-000000000703'), true);

-- =============================================================================
-- 3) 退行なし: active account の approve/redeem は従来どおり成功
-- =============================================================================
select assert_eq('approve_active_still_true',
  rpc_approve_group_claim('00000000-0000-0000-0000-000000000802','00000000-0000-0000-0000-0000000000c1'), true);
select assert_eq('approve_active_group_created',
  (select tenant_source from channel_groups where external_group_id='GACT' and status='active'), 'approved_link_code');
select assert_eq('approve_active_claim_approved',
  (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000802'), 'approved');

select assert_eq('redeem_active_linked',
  rpc_redeem_code_only_claim('aa4','00000000-0000-0000-0000-0000000000fa','GACT2','G2'), 'linked');
select assert_eq('redeem_active_group_created',
  (select tenant_source from channel_groups where external_group_id='GACT2' and status='active'), 'code_only_link');
select assert_eq('redeem_active_code_consumed',
  (select consumed_at is not null from channel_link_codes where id='00000000-0000-0000-0000-000000000704'), true);

select 'DISABLED_FREEZE CHECKS PASSED' as result;

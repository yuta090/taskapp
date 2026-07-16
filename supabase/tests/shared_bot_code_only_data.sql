-- =============================================================================
-- 共有bot PR3b: code_only 即時償還＋errcode標準化(L3) の境界検証（単一セッション）
-- 前提: baseline_stubs.sql → 実 prior migration → 20260715092422〜092426 →
--   20260716111033_shared_bot_code_only_redeem.sql を verbatim 適用済みの使い捨てクラスタ。
-- 実行は run_shared_bot_code_only.sh（スキーマは作らない・手コピー禁止）。
--
-- 検証: redeem 成功(group=code_only_link＋auto_approved＋consumed＋group.org==code.org)／
--   全 rejected 理由(expired/consumed/revoked/wrong_account/wrong_binding_mode)＋
--   dedup(再送で events_seen 増加・行は増えない=DoS 有界)／not-found GC404／
--   23505 already_linked＋敗者未消費／approve・reject の GC4xx。
-- =============================================================================
set client_min_messages = notice;

create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, got; end if;
end $$;

-- SQLSTATE を厳密検証（errcode 標準化の核心）。
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
insert into organizations values ('00000000-0000-0000-0000-0000000000a2');
insert into spaces values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','S1');
insert into spaces values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','S2');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','member');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c2','member');

insert into channel_accounts(id, owner_type, org_id, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f1','platform',null,'line','agentpm秘書','x');
insert into channel_accounts(id, owner_type, org_id, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f2','org','00000000-0000-0000-0000-0000000000a1','line','山田会計','x');

-- code_only コード群（binding_mode='code_only', target=f1）
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at) values
 ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc1', now()+interval '7 day'),
 ('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc2', now()-interval '1 min'),
 ('00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc5', now()+interval '7 day'),
 ('00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc6', now()+interval '7 day'),
 ('00000000-0000-0000-0000-000000000407','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc7', now()+interval '7 day'),
 ('00000000-0000-0000-0000-000000000409','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','we1', now()+interval '20 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at,consumed_at) values
 ('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc3', now()+interval '7 day', now()-interval '5 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at,revoked_at) values
 ('00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','code_only','00000000-0000-0000-0000-0000000000f1','cc4', now()+interval '7 day', now()-interval '2 min');

-- =============================================================================
-- 0) code_hash 双方向 CHECK（必須1-b）: 非shared 行に code_hash を入れる INSERT が拒否される
-- =============================================================================
select assert_sqlstate('code_hash_shared_only_check', $q$
  insert into channel_link_codes(id,org_id,space_id,purpose,code_hash)
  values ('00000000-0000-0000-0000-0000000004ff','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','identity','xhash')
$q$, '23514');  -- check_violation

-- =============================================================================
-- redeem 成功
-- =============================================================================
select assert_eq('redeem_ok_linked',
  rpc_redeem_code_only_claim('cc1','00000000-0000-0000-0000-0000000000f1','GX1','酒屋G'), 'linked');
select assert_eq('redeem_group_tenant_source',
  (select tenant_source from channel_groups where external_group_id='GX1' and status='active'), 'code_only_link');
select assert_eq('redeem_group_org_from_code',
  (select org_id from channel_groups where external_group_id='GX1' and status='active'), '00000000-0000-0000-0000-0000000000a1'::uuid);
select assert_eq('redeem_group_bound_code',
  (select bound_by_link_code_id from channel_groups where external_group_id='GX1' and status='active'), '00000000-0000-0000-0000-000000000401'::uuid);
select assert_eq('redeem_auto_approved_claim',
  (select status from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000401' and external_group_id='GX1'), 'auto_approved');
select assert_eq('redeem_claim_approved_by_null',
  (select approved_by is null from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000401' and external_group_id='GX1'), true);
select assert_eq('redeem_code_consumed',
  (select consumed_at is not null from channel_link_codes where id='00000000-0000-0000-0000-000000000401'), true);
-- 勝ちイベント再送は 23505→already_linked（auto_approved は active_unique で冪等・重複しない）
select assert_eq('redeem_auto_approved_idempotent_count',
  (select count(*)::int from channel_group_claims where status='auto_approved' and external_group_id='GX1'), 1);

-- =============================================================================
-- redeem 無効 → 'rejected' ＋ content-free rejected claim（理由付き）
-- =============================================================================
select assert_eq('redeem_expired_rejected',
  rpc_redeem_code_only_claim('cc2','00000000-0000-0000-0000-0000000000f1','GE','G'), 'rejected');
select assert_eq('redeem_expired_reason',
  (select challenge_label from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000402' and external_group_id='GE'), 'expired');
select assert_eq('redeem_expired_events_seen_1',
  (select events_seen from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000402' and external_group_id='GE'), 1);

-- ★DoS 有界化（必須2）: 同一(コード,グループ)の再送で行は増えず events_seen が増える
select assert_eq('redeem_dedup_resend_rejected',
  rpc_redeem_code_only_claim('cc2','00000000-0000-0000-0000-0000000000f1','GE','G'), 'rejected');
select assert_eq('redeem_dedup_row_count_still_1',
  (select count(*)::int from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000402' and external_group_id='GE' and status='rejected'), 1);
select assert_eq('redeem_dedup_events_seen_2',
  (select events_seen from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000402' and external_group_id='GE'), 2);
-- 100連投しても1行のまま（有界の実証）
do $$ begin for i in 1..100 loop perform rpc_redeem_code_only_claim('cc2','00000000-0000-0000-0000-0000000000f1','GE','G'); end loop; end $$;
select assert_eq('redeem_dedup_bounded_after_100',
  (select count(*)::int from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000402' and external_group_id='GE' and status='rejected'), 1);
select assert_eq('redeem_dedup_events_seen_102',
  (select events_seen from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000402' and external_group_id='GE'), 102);

select assert_eq('redeem_consumed_rejected',
  rpc_redeem_code_only_claim('cc3','00000000-0000-0000-0000-0000000000f1','GC','G'), 'rejected');
select assert_eq('redeem_consumed_reason',
  (select challenge_label from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000403' and external_group_id='GC'), 'consumed');

select assert_eq('redeem_revoked_rejected',
  rpc_redeem_code_only_claim('cc4','00000000-0000-0000-0000-0000000000f1','GR','G'), 'rejected');
select assert_eq('redeem_revoked_reason',
  (select challenge_label from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000404' and external_group_id='GR'), 'revoked');

select assert_eq('redeem_wrong_account_rejected',
  rpc_redeem_code_only_claim('cc5','00000000-0000-0000-0000-0000000000f2','GWA','G'), 'rejected');
select assert_eq('redeem_wrong_account_reason',
  (select challenge_label from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000405' and external_group_id='GWA'), 'wrong_account');
select assert_eq('redeem_wrong_account_code_not_consumed',
  (select consumed_at is null from channel_link_codes where id='00000000-0000-0000-0000-000000000405'), true);

select assert_eq('redeem_web_approval_code_rejected',
  rpc_redeem_code_only_claim('we1','00000000-0000-0000-0000-0000000000f1','GWEB','G'), 'rejected');
select assert_eq('redeem_web_approval_reason',
  (select challenge_label from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000409' and external_group_id='GWEB'), 'wrong_binding_mode');
select assert_eq('redeem_web_approval_no_group',
  (select count(*)::int from channel_groups where external_group_id='GWEB'), 0);

-- =============================================================================
-- redeem not-found → GC404（rejected claim を作らない）
-- =============================================================================
select assert_sqlstate('redeem_not_found_gc404', $q$
  select rpc_redeem_code_only_claim('NOSUCHHASH','00000000-0000-0000-0000-0000000000f1','GNF','G')
$q$, 'GC404');
select assert_eq('redeem_not_found_no_claim',
  (select count(*)::int from channel_group_claims where external_group_id='GNF'), 0);

-- =============================================================================
-- redeem 2重（別コード×同一グループ）→ 'already_linked'・敗者コード未消費・敗者claim無し
-- =============================================================================
select assert_eq('redeem_dup_first_linked',
  rpc_redeem_code_only_claim('cc6','00000000-0000-0000-0000-0000000000f1','GDUP','G'), 'linked');
select assert_eq('redeem_dup_second_already_linked',
  rpc_redeem_code_only_claim('cc7','00000000-0000-0000-0000-0000000000f1','GDUP','G'), 'already_linked');
select assert_eq('redeem_dup_single_active',
  (select count(*)::int from channel_groups where external_group_id='GDUP' and status='active'), 1);
select assert_eq('redeem_dup_winner_consumed',
  (select consumed_at is not null from channel_link_codes where id='00000000-0000-0000-0000-000000000406'), true);
select assert_eq('redeem_dup_loser_not_consumed',
  (select consumed_at is null from channel_link_codes where id='00000000-0000-0000-0000-000000000407'), true);
select assert_eq('redeem_dup_loser_no_claim',
  (select count(*)::int from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000407'), 0);

-- 同一コード再投入は「消費済み」→ rejected（FOR UPDATE 直列化・23505 ではない）
select assert_eq('redeem_same_code_reuse_rejected',
  rpc_redeem_code_only_claim('cc6','00000000-0000-0000-0000-0000000000f1','GDUP2','G'), 'rejected');
select assert_eq('redeem_same_code_reuse_reason',
  (select challenge_label from channel_group_claims where link_code_id='00000000-0000-0000-0000-000000000406' and external_group_id='GDUP2'), 'consumed');

-- =============================================================================
-- errcode 標準化(L3): approve / reject が期待 SQLSTATE で飛ぶ
-- =============================================================================
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at) values
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','w1', now()+interval '20 min'),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','w2', now()-interval '1 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at,consumed_at) values
 ('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','w3', now()+interval '20 min', now()-interval '5 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at,revoked_at) values
 ('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','w4', now()+interval '20 min', now()-interval '2 min');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id) values
 ('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-0000000000f1','GAP1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1'),
 ('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-0000000000f1','GAP2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1'),
 ('00000000-0000-0000-0000-000000000603','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-0000000000f1','GAP3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1'),
 ('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-0000000000f1','GAP4','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');

select assert_sqlstate('approve_unknown_gc404', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-0000000000c1')
$q$, 'GC404');
select assert_sqlstate('approve_cross_org_gc403', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-0000000000c2')
$q$, 'GC403');
select assert_sqlstate('approve_expired_gc422', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-0000000000c1')
$q$, 'GC422');
select assert_sqlstate('approve_consumed_gc409', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000603','00000000-0000-0000-0000-0000000000c1')
$q$, 'GC409');
select assert_sqlstate('approve_revoked_gc422', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-0000000000c1')
$q$, 'GC422');
select assert_sqlstate('reject_unknown_gc404', $q$
  select rpc_reject_group_claim('00000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-0000000000c1')
$q$, 'GC404');
select assert_sqlstate('reject_outsider_gc403', $q$
  select rpc_reject_group_claim('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-0000000000c9')
$q$, 'GC403');

-- 正常系（errcode 追加でロジック不変＝成功が壊れていないこと）
select assert_eq('approve_still_true',
  rpc_approve_group_claim('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-0000000000c1'), true);
select assert_eq('approve_group_created',
  (select tenant_source from channel_groups where external_group_id='GAP1' and status='active'), 'approved_link_code');

select 'CODE_ONLY + L3 CHECKS PASSED' as result;

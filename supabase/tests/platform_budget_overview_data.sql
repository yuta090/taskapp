-- =============================================================================
-- 共有bot(共通LINE) グローバル予算層: 運用者向け可視化関数 app_platform_budget_overview() 検証
-- 前提: baseline_stubs.sql → 実 prior migration → 20260715092422〜092426 →
--   20260716175640/175641/183019 → 20260719100549 → 20260719100634 →
--   20260720201116_platform_budget_overview.sql を verbatim 適用済みの使い捨てクラスタ。
-- 実行は run_platform_budget_overview.sh（スキーマは作らない・手コピー禁止）。
--
-- 検証:
--   (1) platform account ごとに1行返り、used_current_month が cron 集計と一致（当月・sent・全org合算）。
--   (2) remaining = max(budget - used, 0)、soft_threshold = ceil(budget*0.8)。
--   (3) state は platform_channel_budget.state をそのまま反映（refresh後に一致）。
--   (4) 並びは remaining 昇順（残量が少ない account が先頭）。
--   (5) security definer だが authenticated からは実行不可（42501）。
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
insert into organizations values ('00000000-0000-0000-0000-0000000000a1'); -- orgA
insert into organizations values ('00000000-0000-0000-0000-0000000000a2'); -- orgB

-- platform account P1（相乗り・org_id=NULL）と P2（別の platform account・使用0）。
insert into channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f1', null, 'platform', 'line', 'agentpm秘書', 'enc');
insert into channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f2', null, 'platform', 'line', 'agentpm秘書2', 'enc');

create or replace function seed_billable_account(p_account uuid, p_org uuid, n int) returns void
language plpgsql as $$
declare i int;
begin
  for i in 1..n loop
    insert into channel_messages(org_id, account_id, channel, direction, actor, billable_push, status, occurred_at)
      values (p_org, p_account, 'line', 'outbound', 'secretary', true, 'sent', now());
  end loop;
end $$;

-- P1: orgA=100 + orgB=59 = 159（当月・全org合算）。P2: 0件。
select seed_billable_account('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 100);
select seed_billable_account('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 59);
-- 前月分は当月集計・remaining に影響しない（月初リセット）。
insert into channel_messages(org_id, account_id, channel, direction, actor, billable_push, status, occurred_at)
  select '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f1','line','outbound','secretary', true, 'sent', now() - interval '45 days'
  from generate_series(1, 20);

select app_refresh_platform_budget_state();

-- ---- (1)(2)(3) P1 の行内容 --------------------------------------------------
select assert_eq('overview_p1_used_159',
  (select used_current_month from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f1'), 159::bigint);
select assert_eq('overview_p1_budget_200',
  (select monthly_push_budget from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f1'), 200);
select assert_eq('overview_p1_remaining_41',
  (select remaining from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f1'), 41);
select assert_eq('overview_p1_soft_threshold_160',
  (select soft_threshold from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f1'), 160);
select assert_eq('overview_p1_state_ok',
  (select state from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f1'), 'ok');
select assert_eq('overview_p1_display_name',
  (select display_name from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f1'), 'agentpm秘書');

-- P2 は使用0・残量満額。
select assert_eq('overview_p2_used_0',
  (select used_current_month from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f2'), 0::bigint);
select assert_eq('overview_p2_remaining_200',
  (select remaining from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f2'), 200);

-- 2つの platform account 両方が返る（org account は対象外＝そもそも予算行が無い）。
select assert_eq('overview_row_count_2',
  (select count(*) from app_platform_budget_overview()), 2::bigint);

-- ---- (4) 並びは remaining 昇順（P1=41 が P2=200 より先頭） --------------------
select assert_eq('overview_order_remaining_asc_first_is_p1',
  (select account_id from app_platform_budget_overview() limit 1), '00000000-0000-0000-0000-0000000000f1'::uuid);

-- ---- (5) hard を手動で立てると overview にも即反映（緊急ブレーキの可視化） ------
update platform_channel_budget set state='hard', updated_at=now() where account_id='00000000-0000-0000-0000-0000000000f2';
select assert_eq('overview_p2_manual_hard_reflected',
  (select state from app_platform_budget_overview() where account_id='00000000-0000-0000-0000-0000000000f2'), 'hard');

-- ---- (6) authenticated は実行不可（service role 専用） ------------------------
set role authenticated;
select assert_sqlstate('authenticated_overview_forbidden', $q$
  select * from app_platform_budget_overview()
$q$, '42501');
reset role;

-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'PLATFORM BUDGET OVERVIEW CHECKS PASSED'; end $$;

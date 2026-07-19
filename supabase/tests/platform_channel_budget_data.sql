-- =============================================================================
-- 共有bot(共通LINE) グローバル予算層: (account_id, 月) 集計 → platform_channel_budget.state 検証
-- 前提: baseline_stubs.sql → 実 prior migration → 20260715092422〜092426 →
--   20260716175640/175641/183019 → 20260719100549_platform_channel_budget.sql →
--   20260719100634_platform_budget_state_cron.sql を verbatim 適用済みの使い捨てクラスタ。
-- 実行は run_platform_channel_budget.sh（スキーマは作らない・手コピー禁止）。
--
-- 検証:
--   (1) 自動プロビジョニング: owner_type='platform' の account のみ行が作られる
--       （owner_type='org' には作られない）。既定 budget=200 / state='ok'。
--   (2) platform_channel_budget への直接 INSERT が owner_type='org' の account_id で拒否される
--       （platform_channel_budget_guard トリガー）。
--   (3) account軸の全org横断合算（org_idフィルタ無し）: orgA=100 + orgB=59 = 159 → ok。
--       160件目(合計160)で soft（ceil(200*0.8)=160）。200件で hard。
--   (4) 集計対象は billable_push=true かつ status='sent' のみ（queued/failed は除外）。
--   (5) 月初リセット: 前月分のみ持つ別accountは当月再計算で 'ok'（前月分が積み上がらない）。
--   (6) RLS: authenticated ロールは select/insert/update いずれも不可（権限自体が無い＝42501）。
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

-- 共有bot(platform)account P1。org_id=NULL（複数orgで相乗り）。
insert into channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f1', null, 'platform', 'line', 'agentpm秘書', 'enc');
-- 専用bot(org)account O1。予算層の対象外。
insert into channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'org', 'line', '山田会計', 'enc');
-- 前月分のみ計上される検証用の別platform account P3。
insert into channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f3', null, 'platform', 'line', 'agentpm秘書2', 'enc');

-- ---- (1) 自動プロビジョニング: 0件の状態で先に一度 refresh（行が作られるだけ） -----
select app_refresh_platform_budget_state();
select assert_eq('provision_platform_only_count',
  (select count(*) from platform_channel_budget), 2::bigint);
select assert_eq('provision_p1_default_budget_200',
  (select monthly_push_budget from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f1'), 200);
select assert_eq('provision_p1_default_state_ok',
  (select state from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f1'), 'ok');
select assert_eq('provision_org_account_no_row',
  (select count(*) from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f2'), 0::bigint);

-- ---- (2) org account への直接INSERTはトリガーで拒否 --------------------------
select assert_sqlstate('guard_rejects_org_owned_account', $q$
  insert into platform_channel_budget(account_id) values ('00000000-0000-0000-0000-0000000000f2')
$q$, 'P0001');

-- ---- billable push 行を account へ n 件入れるヘルパ（org横断・occurred_at=当月 now）。 -----
create or replace function seed_billable_account(p_account uuid, p_org uuid, n int) returns void
language plpgsql as $$
declare i int;
begin
  for i in 1..n loop
    insert into channel_messages(org_id, account_id, channel, direction, actor, billable_push, status, occurred_at)
      values (p_org, p_account, 'line', 'outbound', 'secretary', true, 'sent', now());
  end loop;
end $$;

-- ---- (3a) orgA=100 + orgB=59 = 159（org_idフィルタ無しで合算）→ ok -----------
select seed_billable_account('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 100);
select seed_billable_account('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 59);
select app_refresh_platform_budget_state();
select assert_eq('count_p1_current_month_159',
  (select count(*) from channel_messages m
     where m.billable_push and m.status='sent' and m.account_id='00000000-0000-0000-0000-0000000000f1'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 159::bigint);
select assert_eq('state_p1_159_ok',
  (select state from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f1'), 'ok');

-- ---- (3b) 160件目（合計160）→ soft（ceil(200*0.8)=160） ----------------------
select seed_billable_account('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 1);
select app_refresh_platform_budget_state();
select assert_eq('state_p1_160_soft',
  (select state from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f1'), 'soft');

-- ---- (3c) 合計200件 → hard ---------------------------------------------------
select seed_billable_account('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 40);
select app_refresh_platform_budget_state();
select assert_eq('count_p1_final_200',
  (select count(*) from channel_messages m
     where m.billable_push and m.status='sent' and m.account_id='00000000-0000-0000-0000-0000000000f1'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 200::bigint);
select assert_eq('state_p1_200_hard',
  (select state from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f1'), 'hard');

-- ---- (4) sent以外(queued/failed)は集計対象外（過大計上を防ぐ） -----------------
insert into channel_messages(org_id, account_id, channel, direction, actor, billable_push, status, occurred_at)
  values
    ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f1','line','outbound','secretary', true, 'failed', now()),
    ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f1','line','outbound','secretary', true, 'queued', now());
select assert_eq('count_p1_sent_only_still_200_excludes_failed_queued',
  (select count(*) from channel_messages m
     where m.billable_push and m.status='sent' and m.account_id='00000000-0000-0000-0000-0000000000f1'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 200::bigint);

-- ---- (5) 月初リセット: 前月分のみのaccount P3は当月再計算で ok ----------------
-- P3へ前月分(45日前)を300件（budget超過相当）投入。当月には一切無い。
insert into channel_messages(org_id, account_id, channel, direction, actor, billable_push, status, occurred_at)
  select '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f3','line','outbound','secretary', true, 'sent', now() - interval '45 days'
  from generate_series(1, 300);
select app_refresh_platform_budget_state();
select assert_eq('state_p3_prev_month_only_ok',
  (select state from platform_channel_budget where account_id='00000000-0000-0000-0000-0000000000f3'), 'ok');
select assert_eq('count_p3_current_month_0',
  (select count(*) from channel_messages m
     where m.billable_push and m.status='sent' and m.account_id='00000000-0000-0000-0000-0000000000f3'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 0::bigint);

-- ---- (6) RLS: authenticated は select/insert/update いずれも不可 --------------
set role authenticated;
select assert_sqlstate('authenticated_select_forbidden', $q$
  select count(*) from platform_channel_budget
$q$, '42501');
select assert_sqlstate('authenticated_insert_forbidden', $q$
  insert into platform_channel_budget(account_id) values ('00000000-0000-0000-0000-0000000000f1')
$q$, '42501');
select assert_sqlstate('authenticated_update_forbidden', $q$
  update platform_channel_budget set state='ok' where account_id='00000000-0000-0000-0000-0000000000f1'
$q$, '42501');
reset role;

-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'PLATFORM BUDGET CHECKS PASSED'; end $$;

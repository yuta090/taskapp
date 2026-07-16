-- =============================================================================
-- 共有bot PR4: メータリング（billable_push 集計 → org_channel_policy.state 更新）境界検証
-- 前提: baseline_stubs.sql → 実 prior migration → 20260715092422〜092426 →
--   20260716175640_shared_bot_metering_billable_push.sql →
--   20260716175641_shared_bot_metering_state_cron.sql →
--   20260716183019_shared_bot_metering_sent_only.sql を verbatim 適用済みの使い捨てクラスタ。
-- 実行は run_shared_bot_metering.sh（スキーマは作らない・手コピー禁止）。
--
-- 検証:
--   (1) billable_push は既定 false（集計対象外）。
--   (2) 集計対象は billable_push=true の outbound だけ（reply/inbound/前月は除外）。
--   (3) quota=10 で 7→ok / 8→soft(ceil(10*0.8)=8) / 10→hard の閾値遷移。
--   (4) monthly_push_quota=NULL の org は state を 'ok' に正規化（quota 撤廃の追従）。
--   (5) policy 行の無い org は更新対象外（暗黙 ok/none）。
--   (6) console 読取関数 app_org_channel_push_usage_current_month は非内部呼び出しで 42501。
--   (7) Fix3(20260716183019): billable_push=true でも status<>'sent'（queued/failed）の行は
--       当月カウントに入らない（失敗/未送信pushの過大計上を防ぐ）。
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
insert into organizations values ('00000000-0000-0000-0000-0000000000a1'); -- orgA quota=10
insert into organizations values ('00000000-0000-0000-0000-0000000000a2'); -- orgB quota=NULL
insert into organizations values ('00000000-0000-0000-0000-0000000000a3'); -- orgC no policy row
insert into organizations values ('00000000-0000-0000-0000-0000000000a4'); -- orgD quota=5（Fix3: sent以外は集計外）

-- policy 行: orgA=quota10/ok, orgB=quota NULL だが初期 state を hard にして「正規化で ok に戻る」を検証。
insert into org_channel_policy(org_id, monthly_push_quota, on_exceed, state)
  values ('00000000-0000-0000-0000-0000000000a1', 10, 'block', 'ok');
insert into org_channel_policy(org_id, monthly_push_quota, on_exceed, state)
  values ('00000000-0000-0000-0000-0000000000a2', null, 'none', 'hard');
-- orgC は policy 行を作らない（暗黙 ok/none）。
insert into org_channel_policy(org_id, monthly_push_quota, on_exceed, state)
  values ('00000000-0000-0000-0000-0000000000a4', 5, 'block', 'ok');

-- billable push 行を org へ n 件入れるヘルパ（occurred_at=当月 now）。
-- Fix3(20260716183019)で集計は status='sent' のみを見るため、実際に送信成功した体で
-- status='sent' を明示する（他ケースの状態遷移(3a〜3c)は「実送信済みpush」を模した数値のため）。
create or replace function seed_billable(p_org uuid, n int) returns void
language plpgsql as $$
declare i int;
begin
  for i in 1..n loop
    insert into channel_messages(org_id, channel, direction, actor, billable_push, status, occurred_at)
      values (p_org, 'line', 'outbound', 'secretary', true, 'sent', now());
  end loop;
end $$;

-- ---- (1) billable_push 既定 false ------------------------------------------
insert into channel_messages(id, org_id, channel, direction, actor, occurred_at)
  values ('00000000-0000-0000-0000-000000009001','00000000-0000-0000-0000-0000000000a1','line','outbound','secretary', now());
select assert_eq('billable_push_default_false',
  (select billable_push from channel_messages where id='00000000-0000-0000-0000-000000009001'), false);

-- ---- (2) 集計対象は billable のみ（reply/inbound/前月を除外） ----------------
-- reply 配信（outbound だが billable_push=false）
insert into channel_messages(org_id, channel, direction, actor, billable_push, occurred_at)
  values ('00000000-0000-0000-0000-0000000000a1','line','outbound','secretary', false, now());
-- inbound
insert into channel_messages(org_id, channel, direction, actor, billable_push, occurred_at)
  values ('00000000-0000-0000-0000-0000000000a1','line','inbound','client', false, now());
-- billable だが前月（40日前）→ 当月集計から除外
insert into channel_messages(org_id, channel, direction, actor, billable_push, occurred_at)
  values ('00000000-0000-0000-0000-0000000000a1','line','outbound','secretary', true, now() - interval '40 days');

-- orgA 当月 billable を 7 件に（上記除外分はカウントされない想定）
select seed_billable('00000000-0000-0000-0000-0000000000a1', 7);

-- ---- (3a) 7件 → ok ----------------------------------------------------------
select app_refresh_channel_metering_state();
select assert_eq('state_orgA_7_ok',
  (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), 'ok');
-- 当月 billable の実数が 7（除外が効いている）
select assert_eq('count_orgA_current_month_7',
  (select count(*) from channel_messages m
     where m.billable_push and m.org_id='00000000-0000-0000-0000-0000000000a1'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 7::bigint);

-- ---- (4) quota NULL の orgB は ok に正規化 ----------------------------------
select assert_eq('state_orgB_null_quota_normalized_ok',
  (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a2'), 'ok');

-- ---- (5) policy 行の無い orgC は作られない（暗黙 ok/none） -------------------
select assert_eq('orgC_no_policy_row',
  (select count(*) from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a3'), 0::bigint);

-- ---- (3b) 8件 → soft（閾値 ceil(10*0.8)=8）----------------------------------
select seed_billable('00000000-0000-0000-0000-0000000000a1', 1);
select app_refresh_channel_metering_state();
select assert_eq('state_orgA_8_soft',
  (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), 'soft');

-- ---- (3c) 10件 → hard -------------------------------------------------------
select seed_billable('00000000-0000-0000-0000-0000000000a1', 2);
select app_refresh_channel_metering_state();
select assert_eq('state_orgA_10_hard',
  (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), 'hard');
select assert_eq('count_orgA_final_10',
  (select count(*) from channel_messages m
     where m.billable_push and m.org_id='00000000-0000-0000-0000-0000000000a1'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 10::bigint);

-- ---- (6) console 読取関数は非内部呼び出しで 42501 --------------------------
-- psql セッションは auth.uid() が null → app_is_org_internal=false → forbidden。
select assert_sqlstate('usage_fn_forbidden_non_internal',
  $q$ select app_org_channel_push_usage_current_month('00000000-0000-0000-0000-0000000000a1') $q$,
  '42501');

-- ---- (7) Fix3: billable=true でも status<>'sent' は集計外（過大計上を防ぐ） -----
-- orgD quota=5。sent 3件 + failed 1件 + queued 1件 = billable_push行としては5件だが、
-- 実際に送信成功した(status='sent')のは3件だけなので state は 'ok'（5件ならhard相当になるはず）。
insert into channel_messages(org_id, channel, direction, actor, billable_push, status, occurred_at)
  values
    ('00000000-0000-0000-0000-0000000000a4','line','outbound','secretary', true, 'sent',   now()),
    ('00000000-0000-0000-0000-0000000000a4','line','outbound','secretary', true, 'sent',   now()),
    ('00000000-0000-0000-0000-0000000000a4','line','outbound','secretary', true, 'sent',   now()),
    ('00000000-0000-0000-0000-0000000000a4','line','outbound','secretary', true, 'failed', now()),
    ('00000000-0000-0000-0000-0000000000a4','line','outbound','secretary', true, 'queued', now());

select app_refresh_channel_metering_state();
select assert_eq('state_orgD_sent_only_3_of_5_ok',
  (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a4'), 'ok');
select assert_eq('count_orgD_sent_only_3',
  (select count(*) from channel_messages m
     where m.billable_push and m.status = 'sent' and m.org_id='00000000-0000-0000-0000-0000000000a4'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 3::bigint);
-- billable_push行自体は5件（failed/queuedも含む）であることの対照確認
select assert_eq('count_orgD_billable_push_rows_5_including_non_sent',
  (select count(*) from channel_messages m
     where m.billable_push and m.org_id='00000000-0000-0000-0000-0000000000a4'
       and m.occurred_at >= (select month_from from app_jst_current_month_bounds())
       and m.occurred_at <  (select month_to   from app_jst_current_month_bounds())), 5::bigint);

-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'METERING CHECKS PASSED'; end $$;

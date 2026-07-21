-- =============================================================================
-- 共通LINE org別クォータ同期(トリガー＋backfill) 検証
-- 前提: baseline_stubs → 20260703_001_rls_helpers → 20260715092426_shared_bot_org_channel_policy →
--   harness/org_billing_stub.sql（org_billing スタブ＋既存行）→ 20260720201858_org_push_quota_from_plan.sql
--   を verbatim 適用済みの使い捨てクラスタ。実行は run_org_push_quota_sync.sh。
--
-- 検証:
--   (backfill) 適用時に既存 org(b1=free / b2=pro active) の quota が 50 / NULL に同期される。
--   (trigger insert) 新規 free/active org 作成で quota=50（無料org作成の縮退が効くようになる）。
--   (trigger upgrade) pro/active へ更新で NULL（無制限＝アップグレードで縮退解除）。
--   (trigger downgrade) free へ戻すと 50。canceled も 50。
--   (past_due grace) 猶予内=NULL / 猶予切れ=50。
--   (unknown plan) fail-closed で 50。
--   (非破壊) allow_code_only 等の既存列を上書きしない。
-- =============================================================================
set client_min_messages = notice;

create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, coalesce(got::text, 'NULL'); end if;
end $$;

create or replace function quota_of(p_org uuid) returns int
language sql stable as $$
  select monthly_push_quota from public.org_channel_policy where org_id = p_org
$$;

create or replace function on_exceed_of(p_org uuid) returns text
language sql stable as $$
  select on_exceed from public.org_channel_policy where org_id = p_org
$$;

-- ---- (backfill) 既存行が migration 適用時に同期済み ---------------------------
select assert_eq('backfill_b1_free_50', quota_of('00000000-0000-0000-0000-0000000000b1'), 50);
select assert_eq('backfill_b2_pro_null', quota_of('00000000-0000-0000-0000-0000000000b2'), null::int);
-- on_exceed も backfill でプラン由来に同期される（free=block=実抑止 / paid=none）
select assert_eq('backfill_b1_free_block', on_exceed_of('00000000-0000-0000-0000-0000000000b1'), 'block');
select assert_eq('backfill_b2_pro_none', on_exceed_of('00000000-0000-0000-0000-0000000000b2'), 'none');

-- ---- (trigger insert) 新規 free/active org 作成 → 50 -------------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000c1');
insert into org_billing(org_id, plan_id, status) values ('00000000-0000-0000-0000-0000000000c1', 'free', 'active');
select assert_eq('insert_free_creates_policy_50', quota_of('00000000-0000-0000-0000-0000000000c1'), 50);
select assert_eq('insert_free_on_exceed_block', on_exceed_of('00000000-0000-0000-0000-0000000000c1'), 'block');

-- ---- (trigger upgrade) free → pro/active → NULL -----------------------------
update org_billing set plan_id='pro', status='active', current_period_end=now()+interval '30 days'
  where org_id='00000000-0000-0000-0000-0000000000c1';
select assert_eq('upgrade_pro_sets_null', quota_of('00000000-0000-0000-0000-0000000000c1'), null::int);
select assert_eq('upgrade_pro_on_exceed_none', on_exceed_of('00000000-0000-0000-0000-0000000000c1'), 'none');

-- ---- (trigger downgrade) pro → free → 50 ------------------------------------
update org_billing set plan_id='free', status='active', current_period_end=null
  where org_id='00000000-0000-0000-0000-0000000000c1';
select assert_eq('downgrade_free_sets_50', quota_of('00000000-0000-0000-0000-0000000000c1'), 50);
select assert_eq('downgrade_free_on_exceed_block', on_exceed_of('00000000-0000-0000-0000-0000000000c1'), 'block');

-- ---- (canceled) pro だが canceled → 50 --------------------------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000c2');
insert into org_billing(org_id, plan_id, status) values ('00000000-0000-0000-0000-0000000000c2', 'pro', 'canceled');
select assert_eq('canceled_pro_50', quota_of('00000000-0000-0000-0000-0000000000c2'), 50);

-- ---- (past_due 猶予内) cpe=now() → now <= cpe+14d 真 → NULL ------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000c3');
insert into org_billing(org_id, plan_id, status, current_period_end)
  values ('00000000-0000-0000-0000-0000000000c3', 'pro', 'past_due', now());
select assert_eq('past_due_in_grace_null', quota_of('00000000-0000-0000-0000-0000000000c3'), null::int);

-- ---- (past_due 猶予切れ) cpe=now()-20d → now <= cpe+14d(=now-6d) 偽 → 50 -----
insert into organizations values ('00000000-0000-0000-0000-0000000000c4');
insert into org_billing(org_id, plan_id, status, current_period_end)
  values ('00000000-0000-0000-0000-0000000000c4', 'pro', 'past_due', now() - interval '20 days');
select assert_eq('past_due_after_grace_50', quota_of('00000000-0000-0000-0000-0000000000c4'), 50);
select assert_eq('past_due_after_grace_block', on_exceed_of('00000000-0000-0000-0000-0000000000c4'), 'block');
select assert_eq('past_due_in_grace_none', on_exceed_of('00000000-0000-0000-0000-0000000000c3'), 'none');

-- ---- (unknown plan) fail-closed 50 ------------------------------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000c5');
insert into org_billing(org_id, plan_id, status) values ('00000000-0000-0000-0000-0000000000c5', 'mystery', 'active');
select assert_eq('unknown_plan_failclosed_50', quota_of('00000000-0000-0000-0000-0000000000c5'), 50);
select assert_eq('unknown_plan_failclosed_block', on_exceed_of('00000000-0000-0000-0000-0000000000c5'), 'block');

-- ---- (非破壊) allow_code_only=true を保持したまま quota だけ更新 --------------
update org_channel_policy set allow_code_only=true where org_id='00000000-0000-0000-0000-0000000000c2';
update org_billing set status='active', plan_id='free' where org_id='00000000-0000-0000-0000-0000000000c2';
select assert_eq('preserve_allow_code_only',
  (select allow_code_only from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000c2'), true);
select assert_eq('preserve_row_quota_still_50', quota_of('00000000-0000-0000-0000-0000000000c2'), 50);
select assert_eq('preserve_allow_code_only_free_block', on_exceed_of('00000000-0000-0000-0000-0000000000c2'), 'block');

-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'ORG PUSH QUOTA SYNC CHECKS PASSED'; end $$;

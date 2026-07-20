-- =============================================================================
-- 共通LINE org単位 shared_bot_access backfill 検証
-- 前提: baseline → 実 prior migration(channel_plumbing〜092426) → setup(痕跡) →
--   20260720223422_org_shared_bot_access.sql → org_billing_stub → 20260720201858(quota trigger)
--   を verbatim 適用済みの使い捨てクラスタ。実行は run_org_shared_bot_access.sh。
--
-- 検証:
--   (最重要) platform グループを持つ org は granted（active も 'left'(過去利用) も granted＝既存を切らない）。
--   allow_code_only=true の org は granted。痕跡なしの既存 org は none。自社account保有・platform痕跡なしは none。
--   非クロバー: billing トリガー(monthly_push_quota upsert) が shared_bot_access を潰さない。
-- =============================================================================
set client_min_messages = notice;

create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, coalesce(got::text, 'NULL'); end if;
end $$;

create or replace function access_of(p_org uuid) returns text
language sql stable as $$
  select shared_bot_access from public.org_channel_policy where org_id = p_org
$$;

-- ---- backfill 結果 -----------------------------------------------------------
select assert_eq('active_group_org_granted', access_of('00000000-0000-0000-0000-00000000a001'), 'granted');
select assert_eq('left_group_org_granted',   access_of('00000000-0000-0000-0000-00000000a002'), 'granted');
select assert_eq('allow_code_only_org_granted', access_of('00000000-0000-0000-0000-00000000c000'), 'granted');
-- 痕跡なしの既存 org は policy 行が無い＝暗黙 none（明示行を作らない設計）。
select assert_eq('no_trace_org_none',
  coalesce(access_of('00000000-0000-0000-0000-00000000d001'), 'none'), 'none');
select assert_eq('own_account_org_none',
  coalesce(access_of('00000000-0000-0000-0000-00000000e001'), 'none'), 'none');

-- ---- 非クロバー: billing 書込のトリガーが shared_bot_access を潰さない -----------
-- g1(granted) に org_billing を作る → quota トリガーが org_channel_policy を upsert(monthly_push_quota)。
insert into public.org_billing(org_id, plan_id, status)
  values ('00000000-0000-0000-0000-00000000a001', 'free', 'active');
select assert_eq('billing_trigger_keeps_access_granted',
  access_of('00000000-0000-0000-0000-00000000a001'), 'granted');
select assert_eq('billing_trigger_sets_quota_50',
  (select monthly_push_quota from public.org_channel_policy where org_id='00000000-0000-0000-0000-00000000a001'), 50);

-- 逆に、none の新規 org に billing が入っても access は none のまま（default を保つ）。
insert into public.organizations values ('00000000-0000-0000-0000-00000000d009');
insert into public.org_billing(org_id, plan_id, status) values ('00000000-0000-0000-0000-00000000d009','free','active');
select assert_eq('new_org_billing_access_defaults_none', access_of('00000000-0000-0000-0000-00000000d009'), 'none');

-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'ORG SHARED BOT ACCESS CHECKS PASSED'; end $$;

-- =============================================================================
-- 20260721215120_org_due_reminders_toggle.sql の「再適用（冪等）」検証
-- 前提: org_due_reminders_toggle_data.sql を実行済み（assert_eq / try_as / toggle_as /
--   flag_of が既に存在する）＋ target migration をもう一度 verbatim 適用済み。
--
-- 再適用で壊れてはいけないもの:
--   - 事務所が選んだ due_reminders_enabled の値（列は add if not exists なので default に戻らない）
--   - entitlement / 課金列
--   - 掃除済みの -1440 occurrence 状態（2度目の DELETE は 0 行）
--   - RPC / ヘルパ（create or replace）と権限（revoke/grant の再実行）
-- =============================================================================
set client_min_messages = notice;

-- 事務所の選好が保存されたまま（O_ROW=true / O_NOROW=false は data.sql 実行後の状態）
select assert_eq('I1_flag_preserved_o_row',   flag_of('00000000-0000-0000-0000-0000000d0001'), true);
select assert_eq('I2_flag_preserved_o_norow', flag_of('00000000-0000-0000-0000-0000000d0002'), false);

-- entitlement 列も不変
select assert_eq('I3_allow_code_only_preserved',
  (select allow_code_only from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), true);
select assert_eq('I4_shared_bot_access_preserved',
  (select shared_bot_access from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), 'granted');

-- occurrence 掃除は再適用しても副作用なし（残すべき行はそのまま）
select assert_eq('I5_minus1440_pending_still_zero',
  (select count(*)::int from public.task_due_reminder_occurrences
    where offset_minutes = -1440 and status = 'pending'), 0);
select assert_eq('I6_kept_occurrences_intact',
  (select count(*)::int from public.task_due_reminder_occurrences), 5);

-- RPC は再適用後も owner から使える（往復）
select assert_eq('I7_rpc_still_works_off',
  toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', false), false);
select assert_eq('I8_rpc_still_works_on',
  toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', true), true);

-- 直接書込は再適用後も塞がったまま
select assert_eq('I9_direct_update_still_denied',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    update public.org_channel_policy set due_reminders_enabled = false
      where org_id = '00000000-0000-0000-0000-0000000d0001' $q$),
  '42501');

do $$ begin raise notice 'ORG DUE REMINDERS TOGGLE IDEMPOTENT CHECKS PASSED'; end $$;

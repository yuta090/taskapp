-- =============================================================================
-- org 単位 自動期限リマインドトグル 検証（20260721215120_org_due_reminders_toggle.sql）
-- 前提: baseline → 実 prior migration 群 → harness/org_due_reminders_toggle_setup.sql →
--   20260721215120（verbatim）を適用済みの使い捨てクラスタ。実行は run_org_due_reminders_toggle.sh。
--
-- 検証の主眼（★HIGH-1）:
--   旧設計（列レベル GRANT ＋ authenticated 向け UPDATE/INSERT ポリシー）は、PostgREST の upsert が
--   ON CONFLICT DO UPDATE SET org_id = excluded.org_id, ... へ展開されるため org_id への UPDATE 権限が
--   必要になり、policy 行が既に存在する org（＝backfill 済みでほぼ全org）で permission denied になる。
--   本ファイルは (A) その失敗を実際に再現し、(B) 新 RPC 経路では同じケースが通ることを示す。
-- =============================================================================
set client_min_messages = notice;

create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, coalesce(got::text, 'NULL'); end if;
end $$;

-- 指定 PG ロール / auth.uid() で SQL を実行し、成功なら 'OK'、失敗なら SQLSTATE を返す。
-- 例外時はサブトランザクション巻き戻しで role/GUC が復帰するが、明示 reset で二重に保証する。
create or replace function try_as(p_role text, p_uid text, p_sql text) returns text
language plpgsql as $$
begin
  begin
    execute format('set role %I', p_role);
    perform set_config('test.uid', coalesce(p_uid, ''), false);
    perform set_config('test.role', p_role, false);
    execute p_sql;
    reset role;
    perform set_config('test.uid', '', false);
    perform set_config('test.role', '', false);
    return 'OK';
  exception when others then
    reset role;
    perform set_config('test.uid', '', false);
    perform set_config('test.role', '', false);
    -- 失敗内容を残す（期待通りの拒否か、別要因の失敗かを後から判別するため）
    raise notice 'try_as denied [%]: %', sqlstate, sqlerrm;
    return sqlstate;
  end;
end $$;

-- authenticated として RPC を呼び、戻り値（反映後の due_reminders_enabled）を返す。
create or replace function toggle_as(p_uid text, p_org uuid, p_enabled boolean) returns boolean
language plpgsql as $$
declare v boolean;
begin
  set role authenticated;
  perform set_config('test.uid', p_uid, false);
  perform set_config('test.role', 'authenticated', false);
  select public.rpc_set_org_due_reminders_enabled(p_org, p_enabled) into v;
  reset role;
  perform set_config('test.uid', '', false);
  perform set_config('test.role', '', false);
  return v;
end $$;

create or replace function flag_of(p_org uuid) returns boolean
language sql stable as $$
  select due_reminders_enabled from public.org_channel_policy where org_id = p_org
$$;


-- =============================================================================
-- (A) ★HIGH-1 再現: 旧設計（列 GRANT ＋ RLS ポリシー）では PostgREST upsert が失敗する
--     旧設計を一時的に再現 → 失敗を確認 → 撤去して migration 適用後の状態へ戻す。
-- =============================================================================
grant update (due_reminders_enabled) on public.org_channel_policy to authenticated;
grant insert (org_id, due_reminders_enabled) on public.org_channel_policy to authenticated;
create policy org_channel_policy_update_due_reminders on public.org_channel_policy
  for update to authenticated
  using (org_id in (select org_id from public.org_memberships where user_id = auth.uid() and role in ('owner','admin')))
  with check (org_id in (select org_id from public.org_memberships where user_id = auth.uid() and role in ('owner','admin')));
create policy org_channel_policy_insert_due_reminders on public.org_channel_policy
  for insert to authenticated
  with check (org_id in (select org_id from public.org_memberships where user_id = auth.uid() and role in ('owner','admin')));

-- PostgREST の upsert(onConflict='org_id') が実際に発行する形。SET 句に org_id が入るのが肝。
select assert_eq('A1_legacy_upsert_denied_on_existing_row',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    insert into public.org_channel_policy (org_id, due_reminders_enabled)
    values ('00000000-0000-0000-0000-0000000d0001', false)
    on conflict (org_id) do update
      set org_id = excluded.org_id,
          due_reminders_enabled = excluded.due_reminders_enabled
  $q$),
  '42501');
-- 旧設計では owner が自 org のトグルを保存できていなかった（値が変わっていない）ことを確認。
select assert_eq('A2_legacy_left_value_unchanged', flag_of('00000000-0000-0000-0000-0000000d0001'), true);

-- 原因の特定: 同じ文から SET 句の org_id を外すと通る＝失敗要因は「PostgREST が SET に org_id を
-- 含めること」であり、列 GRANT を due_reminders_enabled に絞る限り回避できない（＝旧設計は不成立）。
select assert_eq('A3_same_upsert_without_org_id_in_set_succeeds',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    insert into public.org_channel_policy (org_id, due_reminders_enabled)
    values ('00000000-0000-0000-0000-0000000d0001', false)
    on conflict (org_id) do update
      set due_reminders_enabled = excluded.due_reminders_enabled
  $q$),
  'OK');
-- 以降の検証のため初期値へ戻す（postgres＝service role 相当で直接復元）
update public.org_channel_policy set due_reminders_enabled = true
  where org_id = '00000000-0000-0000-0000-0000000d0001';

-- 旧設計を撤去（＝migration 適用後の正しい状態に戻す）
drop policy org_channel_policy_update_due_reminders on public.org_channel_policy;
drop policy org_channel_policy_insert_due_reminders on public.org_channel_policy;
revoke update (due_reminders_enabled) on public.org_channel_policy from authenticated;
revoke insert (org_id, due_reminders_enabled) on public.org_channel_policy from authenticated;
revoke insert, update, delete on table public.org_channel_policy from anon, authenticated;


-- =============================================================================
-- (B) 新 RPC: owner/admin が行の有無に関わらずトグルできる
-- =============================================================================
-- B1: ★行が既に存在する org（HIGH-1 で壊れていたケース）で owner が false へ
select assert_eq('B1_owner_toggle_off_returns_false',
  toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', false), false);
select assert_eq('B1_owner_toggle_off_persisted', flag_of('00000000-0000-0000-0000-0000000d0001'), false);

-- B2: 往復（false → true）
select assert_eq('B2_owner_toggle_on_returns_true',
  toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', true), true);
select assert_eq('B2_owner_toggle_on_persisted', flag_of('00000000-0000-0000-0000-0000000d0001'), true);

-- B3: admin も可（前方互換ロール）
select assert_eq('B3_admin_toggle_off',
  toggle_as('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000d0001', false), false);

-- B4: 同じ値の再設定は冪等（エラーにならず false のまま）
select assert_eq('B4_toggle_idempotent_same_value',
  toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', false), false);

-- B5: policy 行が無い org は insert 経路で作られる
select assert_eq('B5_norow_before_is_absent', flag_of('00000000-0000-0000-0000-0000000d0002'), null::boolean);
select assert_eq('B5_norow_toggle_off',
  toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0002', false), false);
select assert_eq('B5_norow_row_created', flag_of('00000000-0000-0000-0000-0000000d0002'), false);
-- 新規行の他列は table default＝すべて安全側（entitlement は増えない）
select assert_eq('B5_norow_allow_code_only_default',
  (select allow_code_only from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0002'), false);
select assert_eq('B5_norow_shared_bot_access_default',
  (select shared_bot_access from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0002'), 'none');
select assert_eq('B5_norow_state_default',
  (select state from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0002'), 'ok');
select assert_eq('B5_norow_quota_default',
  (select monthly_push_quota from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0002'), null::int);

-- B6: service_role は uid 無しでも実行できる（運用/管理クライアント経路）
select assert_eq('B6_service_role_allowed',
  try_as('service_role', null, $q$ select public.rpc_set_org_due_reminders_enabled('00000000-0000-0000-0000-0000000d0001', true) $q$),
  'OK');
select assert_eq('B6_service_role_persisted', flag_of('00000000-0000-0000-0000-0000000d0001'), true);


-- =============================================================================
-- (C) ★entitlement / 課金列を一切触らない
--     setup で仕込んだ非デフォルト値（allow_code_only=true / shared_bot_access='granted' /
--     state='soft' / quota=50 / on_exceed='block'）が B1〜B6 のトグル後も不変であること。
-- =============================================================================
select assert_eq('C1_allow_code_only_untouched',
  (select allow_code_only from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), true);
select assert_eq('C2_shared_bot_access_untouched',
  (select shared_bot_access from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), 'granted');
select assert_eq('C3_state_untouched',
  (select state from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), 'soft');
select assert_eq('C4_quota_untouched',
  (select monthly_push_quota from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), 50);
select assert_eq('C5_on_exceed_untouched',
  (select on_exceed from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), 'block');

-- 課金トリガー(20260720201858/20260721193407)側も本列を潰さない（相互非クロバー）
select toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', false);
update public.org_billing set plan_id = 'pro', current_period_end = now() + interval '30 days'
  where org_id = '00000000-0000-0000-0000-0000000d0001';
select assert_eq('C6_billing_trigger_keeps_due_reminders_false',
  flag_of('00000000-0000-0000-0000-0000000d0001'), false);
select assert_eq('C6_billing_trigger_updated_quota',
  (select monthly_push_quota from public.org_channel_policy where org_id='00000000-0000-0000-0000-0000000d0001'), null::int);
-- 日次フル再同期(app_resync_all_org_push_quota)も本列を潰さない
select public.app_resync_all_org_push_quota();
select assert_eq('C7_resync_keeps_due_reminders_false',
  flag_of('00000000-0000-0000-0000-0000000d0001'), false);
-- 後続の検証のため true に戻す
select toggle_as('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', true);


-- =============================================================================
-- (D) 権限: member / 他org / 未認証 / anon は拒否
-- =============================================================================
select assert_eq('D1_member_forbidden',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0003', $q$ select public.rpc_set_org_due_reminders_enabled('00000000-0000-0000-0000-0000000d0001', false) $q$),
  '42501');
select assert_eq('D2_other_org_owner_forbidden',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0004', $q$ select public.rpc_set_org_due_reminders_enabled('00000000-0000-0000-0000-0000000d0001', false) $q$),
  '42501');
select assert_eq('D3_unauthenticated_forbidden',
  try_as('authenticated', null, $q$ select public.rpc_set_org_due_reminders_enabled('00000000-0000-0000-0000-0000000d0001', false) $q$),
  '42501');
select assert_eq('D4_anon_cannot_execute',
  try_as('anon', null, $q$ select public.rpc_set_org_due_reminders_enabled('00000000-0000-0000-0000-0000000d0001', false) $q$),
  '42501');
select assert_eq('D5_null_arg_rejected',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$ select public.rpc_set_org_due_reminders_enabled('00000000-0000-0000-0000-0000000d0001', null) $q$),
  '22004');
-- 拒否された分だけ値が変わっていないこと
select assert_eq('D6_value_unchanged_after_denials', flag_of('00000000-0000-0000-0000-0000000d0001'), true);


-- =============================================================================
-- (E) authenticated は org_channel_policy を直接書けない（列 GRANT 撤回の確認）
-- =============================================================================
select assert_eq('E1_direct_update_denied',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    update public.org_channel_policy set due_reminders_enabled = false
      where org_id = '00000000-0000-0000-0000-0000000d0001' $q$),
  '42501');
select assert_eq('E2_direct_insert_denied',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    insert into public.org_channel_policy (org_id, due_reminders_enabled)
      values ('00000000-0000-0000-0000-0000000d0002', false) $q$),
  '42501');
select assert_eq('E3_entitlement_update_denied',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    update public.org_channel_policy set allow_code_only = true
      where org_id = '00000000-0000-0000-0000-0000000d0001' $q$),
  '42501');
select assert_eq('E4_direct_delete_denied',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0001', $q$
    delete from public.org_channel_policy where org_id = '00000000-0000-0000-0000-0000000d0001' $q$),
  '42501');
-- SELECT は既存ポリシーどおり内部メンバーに開いたまま（UI の初期表示経路が壊れていない）
select assert_eq('E5_internal_select_still_allowed',
  try_as('authenticated', '00000000-0000-0000-0000-0000000e0003', $q$
    select due_reminders_enabled from public.org_channel_policy
      where org_id = '00000000-0000-0000-0000-0000000d0001' $q$),
  'OK');
-- 旧設計の RLS ポリシーが残っていないこと
select assert_eq('E6_legacy_policies_absent',
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='org_channel_policy'
      and policyname in ('org_channel_policy_update_due_reminders','org_channel_policy_insert_due_reminders')),
  0);
-- 列レベル GRANT が残っていないこと
select assert_eq('E7_no_column_grants_for_authenticated',
  (select count(*)::int from information_schema.column_privileges
    where table_schema='public' and table_name='org_channel_policy'
      and grantee='authenticated' and privilege_type in ('UPDATE','INSERT')),
  0);


-- =============================================================================
-- (F) -1440 occurrence の掃除
-- =============================================================================
select assert_eq('F1_minus1440_pending_deleted',
  (select count(*)::int from public.task_due_reminder_occurrences
    where offset_minutes = -1440 and status = 'pending'), 0);
select assert_eq('F2_minus1440_sent_kept',
  (select count(*)::int from public.task_due_reminder_occurrences
    where offset_minutes = -1440 and status = 'sent'), 1);
select assert_eq('F3_minus1440_leased_kept',
  (select count(*)::int from public.task_due_reminder_occurrences
    where offset_minutes = -1440 and status = 'leased'), 1);
select assert_eq('F4_minus1440_suppressed_kept',
  (select count(*)::int from public.task_due_reminder_occurrences
    where offset_minutes = -1440 and status = 'suppressed'), 1);
select assert_eq('F5_other_offsets_kept',
  (select count(*)::int from public.task_due_reminder_occurrences
    where offset_minutes in (0, 1440)), 2);


-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'ORG DUE REMINDERS TOGGLE CHECKS PASSED'; end $$;

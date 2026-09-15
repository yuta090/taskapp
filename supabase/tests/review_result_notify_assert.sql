-- =============================================================================
-- 社内承認の「承認」「差し戻し」のお知らせ（*_review_result_notify.sql）の挙動検証
-- 前提: run_review_result_notify.sh が migrations → review_result_notify_seed.sql →（GREEN なら）本 migration を
--       適用済み。人物・タスクは review_result_notify_seed.sql を参照。
--
-- label:
--   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS）
--   same_*  変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]（ハーネスが数える）。
--   RPC を呼ぶ確認は1つずつ begin … rollback で包み、互いに影響させない。
--   RPC を呼んだ結果は、呼んだ文とは別の文で読む（同じ文の中の副問い合わせは、呼ぶ前の状態を見るため）。
-- =============================================================================
set client_min_messages = notice;

\set O1 'a0000000-0000-0000-0000-000000000001'
\set S1 'b0000000-0000-0000-0000-000000000001'
\set u_req  'c0000000-0000-0000-0000-000000000001'
\set u_rv1  'c0000000-0000-0000-0000-000000000002'
\set u_rv2  'c0000000-0000-0000-0000-000000000003'
\set u_asg  'c0000000-0000-0000-0000-000000000004'
\set u_cl   'c0000000-0000-0000-0000-000000000005'
\set u_vd   'c0000000-0000-0000-0000-000000000006'
\set u_vw   'c0000000-0000-0000-0000-000000000007'
\set u_nosp 'c0000000-0000-0000-0000-000000000008'
\set T1 'd0000000-0000-0000-0000-000000000001'
\set T2 'd0000000-0000-0000-0000-000000000002'
\set T3 'd0000000-0000-0000-0000-000000000003'
\set T4 'd0000000-0000-0000-0000-000000000004'
\set T5 'd0000000-0000-0000-0000-000000000005'
\set T6 'd0000000-0000-0000-0000-000000000006'
\set T7 'd0000000-0000-0000-0000-000000000007'
\set T8 'd0000000-0000-0000-0000-000000000008'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;

create table if not exists test.people (id uuid primary key, label text not null);
insert into test.people (id, label) values
  (:'u_req', 'req'), (:'u_rv1', 'rv1'), (:'u_rv2', 'rv2'), (:'u_asg', 'asg'),
  (:'u_cl', 'cl'), (:'u_vd', 'vd'), (:'u_vw', 'vw'), (:'u_nosp', 'nosp')
on conflict (id) do nothing;

create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql as $$
begin
  if p_got is not distinct from p_want then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), coalesce(p_want, 'NULL');
  end if;
end $$;

-- p_user として（authenticated・request.jwt.claims の sub）SQL を1つ実行し、postgres に戻る。
-- 成功なら 'ok'、失敗なら 'error:<SQLSTATE>:<文言>'（失敗しても外のトランザクションは続けられる）
create or replace function test.act(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- サーバー（CLI / MCP の道具）として SQL を1つ実行する（service_role・auth.uid() は空）
create or replace function test.act_service(p_sql text)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- 画面から: req が依頼する / 承認する / 差し戻す
create or replace function test.open(p_task uuid, p_reviewers uuid[])
returns text language plpgsql as $$
begin
  return test.act('c0000000-0000-0000-0000-000000000001',
                  format('select public.rpc_review_open(%L::uuid, %L::uuid[])', p_task, p_reviewers));
end $$;

create or replace function test.approve(p_user uuid, p_task uuid)
returns text language plpgsql as $$
begin
  return test.act(p_user, format('select public.rpc_review_approve(%L::uuid, null)', p_task));
end $$;

create or replace function test.block(p_user uuid, p_task uuid, p_reason text)
returns text language plpgsql as $$
begin
  return test.act(p_user, format('select public.rpc_review_block(%L::uuid, %L, null)', p_task, p_reason));
end $$;

create or replace function test.review_id(p_task uuid)
returns text language sql as $$
  select id::text from public.reviews where task_id = p_task;
$$;

-- そのタスクの、指定した種類の受信トレイのお知らせの宛先（人の呼び名をカンマ区切り。1人に2行あれば2回出る）
create or replace function test.recipients(p_task uuid, p_type text)
returns text language sql as $$
  select coalesce(string_agg(coalesce(p.label, n.to_user_id::text), ',' order by coalesce(p.label, n.to_user_id::text)), '')
    from public.notifications n
    left join test.people p on p.id = n.to_user_id
   where n.channel = 'in_app' and n.type = p_type and n.payload->>'task_id' = p_task::text;
$$;

-- そのタスクのお知らせ全部（行の id・宛先・種類・キー・既読・対応済み・作った時刻）
create or replace function test.snapshot_notices(p_task uuid)
returns text language sql as $$
  select coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s', id, to_user_id, type, dedupe_key, read_at, actioned_at,
                                    immediate_email_sent_at, created_at), ',' order by id), '')
    from public.notifications where payload->>'task_id' = p_task::text;
$$;

-- -----------------------------------------------------------------------------
-- 形: 2つの本体の実行権・SECURITY DEFINER・search_path は土台のまま（外からは誰も呼べない）
-- -----------------------------------------------------------------------------
select test.check('same_impl_rights',
  (select string_agg(format('%s definer=%s config=%s public=%s anon=%s authenticated=%s service_role=%s',
                            p.proname, p.prosecdef::text, array_to_string(p.proconfig, ';'),
                            has_function_privilege('public', p.oid, 'execute')::text,
                            has_function_privilege('anon', p.oid, 'execute')::text,
                            has_function_privilege('authenticated', p.oid, 'execute')::text,
                            has_function_privilege('service_role', p.oid, 'execute')::text), ' / ' order by p.proname)
     from pg_proc p
    where p.oid in (to_regprocedure('public._review_approve_impl(uuid,uuid,uuid)'),
                    to_regprocedure('public._review_block_impl(uuid,uuid,text,uuid)'))),
  '_review_approve_impl definer=true config=search_path=public public=false anon=false authenticated=false service_role=false'
  || ' / _review_block_impl definer=true config=search_path=public public=false anon=false authenticated=false service_role=false');

-- -----------------------------------------------------------------------------
-- 承認: 依頼した人と担当者に review_approved が1行ずつ。承認した本人には作らない
-- -----------------------------------------------------------------------------
begin;
select test.check('same_requester_can_open', test.open(:'T1', array[:'u_rv1']::uuid[]), 'ok');
select test.check('same_reviewer_can_approve', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('chg_approve_notifies_requester_and_assignee', test.recipients(:'T1', 'review_approved'), 'asg,req');
select test.check('chg_approve_notice_keys',
  (select string_agg(p.label || '=' || n.dedupe_key, ',' order by p.label)
     from public.notifications n join test.people p on p.id = n.to_user_id
    where n.type = 'review_approved' and n.payload->>'task_id' = :'T1'),
  format('asg=review_approve:%1$s:%2$s:%3$s,req=review_approve:%1$s:%2$s:%4$s', test.review_id(:'T1'), :'u_rv1', :'u_asg', :'u_req'));
-- 新しい出来事として、未読・要対応・即時メール未送信で入る（すぐメール・プッシュの対象）
select test.check('chg_approve_notice_fresh',
  (select format('%s|%s|%s|%s|%s|%s', count(*), bool_and(channel = 'in_app')::text, bool_and(read_at is null)::text,
                 bool_and(actioned_at is null)::text, bool_and(immediate_email_sent_at is null)::text,
                 bool_and(org_id = :'O1' and space_id = :'S1')::text)
     from public.notifications where type = 'review_approved' and payload->>'task_id' = :'T1'),
  '2|true|true|true|true|true');
select test.check('chg_approve_all_text',
  (select format('%s|%s|%s|%s|%s|%s', payload->>'title', payload->>'message', payload->>'all_approved',
                 payload->>'from_user_name', payload->>'task_title', payload->>'task_id')
     from public.notifications where to_user_id = :'u_req' and type = 'review_approved' and payload->>'task_id' = :'T1'),
  format('社内承認がそろいました: 「承認と差し戻しのタスク」|すべての承認者が承認しました。次の作業に進めます。|true|承認する人1|承認と差し戻しのタスク|%s', :'T1'));
select test.check('same_approve_no_notice_to_actor',
  (select count(*)::text from public.notifications where to_user_id = :'u_rv1' and type in ('review_approved', 'ball_passed')), '0');
select test.check('same_approve_completes_review', (select status from public.reviews where task_id = :'T1'), 'approved');
rollback;

-- 承認者が2人: 1人目で「残り1人」、2人目で「そろいました」。お知らせは承認した人ごとに1行
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.approve(:'u_rv1', :'T1');
select test.check('chg_approve_first_of_two_text',
  (select format('%s|%s|%s', payload->>'title', payload->>'message', payload->>'all_approved')
     from public.notifications
    where to_user_id = :'u_req' and dedupe_key = format('review_approve:%s:%s:%s', test.review_id(:'T1'), :'u_rv1', :'u_req')),
  '承認する人1さんが承認しました: 「承認と差し戻しのタスク」|ほかの承認者の返事を待っています（残り1人）。|false');
select test.approve(:'u_rv2', :'T1');
select test.check('chg_approve_second_of_two_text',
  (select format('%s|%s|%s', payload->>'title', payload->>'message', payload->>'all_approved')
     from public.notifications
    where to_user_id = :'u_req' and dedupe_key = format('review_approve:%s:%s:%s', test.review_id(:'T1'), :'u_rv2', :'u_req')),
  '社内承認がそろいました: 「承認と差し戻しのタスク」|すべての承認者が承認しました。次の作業に進めます。|true');
select test.check('chg_approve_one_notice_per_approver', test.recipients(:'T1', 'review_approved'), 'asg,asg,req,req');
rollback;

-- 表示名が空の人が承認: 見出しは「メンバーさん」、from_user_name は null
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.approve(:'u_rv2', :'T1');
select test.check('chg_approve_blank_name_fallback',
  (select format('%s|%s', payload->>'title', coalesce(payload->>'from_user_name', '(null)'))
     from public.notifications where to_user_id = :'u_req' and type = 'review_approved' and payload->>'task_id' = :'T1'),
  'メンバーさんが承認しました: 「承認と差し戻しのタスク」|(null)');
rollback;

-- 既に承認済みの人がもう一度承認しても、お知らせは増えず、読んだものも未読に戻らない
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.approve(:'u_rv1', :'T1');
update public.notifications set read_at = '2026-09-15 00:00:00+00' where type = 'review_approved' and payload->>'task_id' = :'T1';
select test.snapshot_notices(:'T1') as before_reapprove \gset
select test.check('same_reapprove_is_noop', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('same_already_approved_no_extra_notice', test.snapshot_notices(:'T1'), :'before_reapprove');
rollback;

-- 依頼した人＝担当者なら1行
begin;
select test.open(:'T2', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T2');
select test.check('chg_approve_requester_is_assignee_one_row', test.recipients(:'T2', 'review_approved'), 'req');
rollback;

-- 担当者が相手先・協力会社なら、担当者には作らない
begin;
select test.open(:'T3', array[:'u_rv1']::uuid[]);
select test.open(:'T4', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T3');
select test.approve(:'u_rv1', :'T4');
select test.check('chg_approve_skips_client_assignee', test.recipients(:'T3', 'review_approved'), 'req');
select test.check('chg_approve_skips_vendor_assignee', test.recipients(:'T4', 'review_approved'), 'req');
rollback;

-- 担当なし・社内の閲覧者・プロジェクトの役割が無い社内メンバー・承認した本人が担当
begin;
select test.open(:'T5', array[:'u_rv1']::uuid[]);
select test.open(:'T6', array[:'u_rv1']::uuid[]);
select test.open(:'T7', array[:'u_rv1']::uuid[]);
select test.open(:'T8', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T5');
select test.approve(:'u_rv1', :'T6');
select test.approve(:'u_rv1', :'T7');
select test.approve(:'u_rv1', :'T8');
select test.check('chg_approve_no_assignee', test.recipients(:'T5', 'review_approved'), 'req');
select test.check('chg_approve_internal_viewer_assignee', test.recipients(:'T6', 'review_approved'), 'req,vw');
select test.check('chg_approve_no_space_role_assignee', test.recipients(:'T7', 'review_approved'), 'nosp,req');
select test.check('chg_approve_skips_actor_as_assignee', test.recipients(:'T8', 'review_approved'), 'req');
rollback;

-- 承認 → 再依頼（承認者から外して戻す）→ 再承認: 前のお知らせを消して作り直す（プッシュ・即時メールが出る）
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.approve(:'u_rv1', :'T1');
update public.notifications set read_at = now(), actioned_at = now(), immediate_email_sent_at = now()
 where type = 'review_approved' and payload->>'task_id' = :'T1';
select coalesce(string_agg(id::text, ','), 'none') as ids_before_reapprove
  from public.notifications where type = 'review_approved' and payload->>'task_id' = :'T1' \gset
select test.check('same_requester_can_drop_reviewer', test.open(:'T1', array[:'u_rv2']::uuid[]), 'ok');
select test.check('same_requester_can_add_reviewer_back', test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]), 'ok');
select test.check('same_reviewer_can_approve_again', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('chg_approve_again_recreates_notice',
  (select string_agg(format('%s=%s|%s|%s|%s', p.label, (position(n.id::text in :'ids_before_reapprove') = 0)::text,
                            (n.read_at is null)::text, (n.actioned_at is null)::text,
                            (n.immediate_email_sent_at is null)::text), ',' order by p.label)
     from public.notifications n join test.people p on p.id = n.to_user_id
    where n.type = 'review_approved' and n.payload->>'task_id' = :'T1'),
  'asg=true|true|true|true,req=true|true|true|true');
rollback;

-- 承認 → 同じ人が差し戻し → 再依頼 → 再承認: これも作り直す
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T1');
update public.notifications set read_at = now(), actioned_at = now(), immediate_email_sent_at = now()
 where type = 'review_approved' and payload->>'task_id' = :'T1';
select coalesce(string_agg(id::text, ','), 'none') as ids_before_block_reapprove
  from public.notifications where type = 'review_approved' and payload->>'task_id' = :'T1' \gset
select test.check('same_approver_can_block_after_approve', test.block(:'u_rv1', :'T1', '考え直しました'), 'ok');
select test.check('same_requester_can_request_after_block', test.open(:'T1', array[:'u_rv1']::uuid[]), 'ok');
select test.check('same_reviewer_can_approve_after_block', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('chg_approve_after_block_recreates_notice',
  (select string_agg(format('%s=%s|%s|%s|%s', p.label, (position(n.id::text in :'ids_before_block_reapprove') = 0)::text,
                            (n.read_at is null)::text, (n.actioned_at is null)::text,
                            (n.immediate_email_sent_at is null)::text), ',' order by p.label)
     from public.notifications n join test.people p on p.id = n.to_user_id
    where n.type = 'review_approved' and n.payload->>'task_id' = :'T1'),
  'asg=true|true|true|true,req=true|true|true|true');
rollback;

-- 承認者 rv1・rv2 のうち、rv2 が差し戻したあとに rv1 が承認: 保留中の人がいないので「差し戻している承認者がいます」。
-- 「そろったか」の判定（全員 approved）は変えない
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.check('same_other_reviewer_can_block_first', test.block(:'u_rv2', :'T1', '先に差し戻します'), 'ok');
select test.check('same_reviewer_can_approve_after_other_blocked', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('chg_approve_after_other_blocked_text',
  (select string_agg(format('%s=%s|%s|%s', p.label, n.payload->>'title', n.payload->>'message', n.payload->>'all_approved'),
                     ',' order by p.label)
     from public.notifications n join test.people p on p.id = n.to_user_id
    where n.type = 'review_approved' and n.payload->>'task_id' = :'T1'),
  'asg=承認する人1さんが承認しました: 「承認と差し戻しのタスク」|差し戻している承認者がいます。差し戻しの内容を確認してください。|false,'
  || 'req=承認する人1さんが承認しました: 「承認と差し戻しのタスク」|差し戻している承認者がいます。差し戻しの内容を確認してください。|false');
select test.check('same_approve_after_other_blocked_status', (select status from public.reviews where task_id = :'T1'), 'changes_requested');
rollback;

-- 承認者が3人（rv1・rv2・asg。T5 は担当なし）: rv2 が差し戻し → rv1 が承認すると、残りは保留中の asg だけ（1人）。
-- 続けて asg が承認すると、保留中は0人で差し戻し中の rv2 が残るので「差し戻している承認者がいます」
begin;
select test.open(:'T5', array[:'u_rv1', :'u_rv2', :'u_asg']::uuid[]);
select test.block(:'u_rv2', :'T5', '先に差し戻します');
select test.approve(:'u_rv1', :'T5');
select test.check('chg_approve_remaining_counts_pending_only',
  (select format('%s|%s|%s', payload->>'title', payload->>'message', payload->>'all_approved')
     from public.notifications
    where to_user_id = :'u_req' and dedupe_key = format('review_approve:%s:%s:%s', test.review_id(:'T5'), :'u_rv1', :'u_req')),
  '承認する人1さんが承認しました: 「担当のいないタスク」|ほかの承認者の返事を待っています（残り1人）。|false');
select test.check('same_last_pending_can_approve_while_blocked', test.approve(:'u_asg', :'T5'), 'ok');
select test.check('chg_approve_last_pending_while_blocked_text',
  (select format('%s|%s|%s', payload->>'title', payload->>'message', payload->>'all_approved')
     from public.notifications
    where to_user_id = :'u_req' and dedupe_key = format('review_approve:%s:%s:%s', test.review_id(:'T5'), :'u_asg', :'u_req')),
  '担当する人さんが承認しました: 「担当のいないタスク」|差し戻している承認者がいます。差し戻しの内容を確認してください。|false');
rollback;

-- -----------------------------------------------------------------------------
-- 差し戻し: 依頼した人と担当者に ball_passed（review_block:<依頼>:<宛先>）。差し戻した本人には作らない
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('same_reviewer_can_block', test.block(:'u_rv1', :'T1', 'ここを直してください'), 'ok');
select test.check('same_block_requester_key',
  (select string_agg(dedupe_key, ',') from public.notifications
    where to_user_id = :'u_req' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  format('review_block:%s:%s', test.review_id(:'T1'), :'u_req'));
select test.check('chg_block_notifies_requester_and_assignee', test.recipients(:'T1', 'ball_passed'), 'asg,req');
select test.check('chg_block_assignee_key',
  (select string_agg(dedupe_key, ',') from public.notifications
    where to_user_id = :'u_asg' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  format('review_block:%s:%s', test.review_id(:'T1'), :'u_asg'));
select test.check('same_block_requester_payload',
  (select format('%s|%s|%s|%s|%s|%s', payload->>'title', payload->>'message', payload->>'from_user_name',
                 payload->>'ball', payload->>'task_title', payload->>'task_id')
     from public.notifications where to_user_id = :'u_req' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  format('差し戻し: 「承認と差し戻しのタスク」|修正依頼: ここを直してください|承認する人1|internal|承認と差し戻しのタスク|%s', :'T1'));
select test.check('same_block_payload_keys',
  (select string_agg(k, ',' order by k)
     from public.notifications n, jsonb_object_keys(n.payload) k
    where n.to_user_id = :'u_req' and n.type = 'ball_passed' and n.payload->>'task_id' = :'T1'),
  'ball,from_user_name,message,task_id,task_title,title');
select test.check('chg_block_assignee_payload',
  (select format('%s|%s|%s|%s|%s|%s|%s', payload->>'title', payload->>'message', payload->>'from_user_name',
                 payload->>'ball', payload->>'task_title', payload->>'task_id', (read_at is null and immediate_email_sent_at is null)::text)
     from public.notifications where to_user_id = :'u_asg' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  format('差し戻し: 「承認と差し戻しのタスク」|修正依頼: ここを直してください|承認する人1|internal|承認と差し戻しのタスク|%s|true', :'T1'));
select test.check('same_block_no_notice_to_actor',
  (select count(*)::text from public.notifications where to_user_id = :'u_rv1' and type in ('review_approved', 'ball_passed')), '0');
select test.check('same_block_result',
  (select format('%s|%s', r.status, t.ball) from public.reviews r join public.tasks t on t.id = r.task_id where r.task_id = :'T1'),
  'changes_requested|internal');
-- 同じ理由でもう一度押しても何も起きない（お知らせも増えない）
select test.snapshot_notices(:'T1') as before_reblock \gset
select test.check('same_block_repeat_is_noop', test.block(:'u_rv1', :'T1', 'ここを直してください'), 'ok');
select test.check('same_block_repeat_no_extra_notice', test.snapshot_notices(:'T1'), :'before_reblock');
rollback;

-- 依頼した人＝担当者なら1行
begin;
select test.open(:'T2', array[:'u_rv1']::uuid[]);
select test.block(:'u_rv1', :'T2', '直してください');
select test.check('same_block_requester_is_assignee_one_row', test.recipients(:'T2', 'ball_passed'), 'req');
rollback;

-- 担当者が相手先・協力会社なら、担当者には作らない
begin;
select test.open(:'T3', array[:'u_rv1']::uuid[]);
select test.open(:'T4', array[:'u_rv1']::uuid[]);
select test.block(:'u_rv1', :'T3', '直してください');
select test.block(:'u_rv1', :'T4', '直してください');
select test.check('same_block_skips_client_assignee', test.recipients(:'T3', 'ball_passed'), 'req');
select test.check('same_block_skips_vendor_assignee', test.recipients(:'T4', 'ball_passed'), 'req');
rollback;

-- 担当なし・社内の閲覧者・プロジェクトの役割が無い社内メンバー・差し戻した本人が担当
begin;
select test.open(:'T5', array[:'u_rv1']::uuid[]);
select test.open(:'T6', array[:'u_rv1']::uuid[]);
select test.open(:'T7', array[:'u_rv1']::uuid[]);
select test.open(:'T8', array[:'u_rv1']::uuid[]);
select test.block(:'u_rv1', :'T5', '直してください');
select test.block(:'u_rv1', :'T6', '直してください');
select test.block(:'u_rv1', :'T7', '直してください');
select test.block(:'u_rv1', :'T8', '直してください');
select test.check('same_block_no_assignee', test.recipients(:'T5', 'ball_passed'), 'req');
select test.check('chg_block_internal_viewer_assignee', test.recipients(:'T6', 'ball_passed'), 'req,vw');
select test.check('chg_block_no_space_role_assignee', test.recipients(:'T7', 'ball_passed'), 'nosp,req');
select test.check('same_block_skips_actor_as_assignee', test.recipients(:'T8', 'ball_passed'), 'req');
rollback;

-- 差し戻し → 再依頼 → もう一度差し戻し: 前のお知らせを消して作り直す（id が変わり、未読・要対応・即時メール未送信）
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.block(:'u_rv1', :'T1', '最初の理由');
update public.notifications set read_at = now(), actioned_at = now(), immediate_email_sent_at = now()
 where type = 'ball_passed' and payload->>'task_id' = :'T1';
select coalesce((select id::text from public.notifications where to_user_id = :'u_req' and type = 'ball_passed' and payload->>'task_id' = :'T1'), 'none') as reblock_req_id \gset
select coalesce((select id::text from public.notifications where to_user_id = :'u_asg' and type = 'ball_passed' and payload->>'task_id' = :'T1'), 'none') as reblock_asg_id \gset
select test.check('same_requester_can_request_again', test.open(:'T1', array[:'u_rv1']::uuid[]), 'ok');
select test.check('same_reviewer_can_block_again', test.block(:'u_rv1', :'T1', '二度目の理由'), 'ok');
select test.check('chg_block_again_recreates_requester_notice',
  (select format('%s|%s|%s|%s|%s', count(*), bool_and(id::text <> :'reblock_req_id')::text, bool_and(read_at is null)::text,
                 bool_and(actioned_at is null)::text, bool_and(immediate_email_sent_at is null)::text)
     from public.notifications where to_user_id = :'u_req' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  '1|true|true|true|true');
select test.check('chg_block_again_recreates_assignee_notice',
  (select format('%s|%s|%s|%s|%s', count(*), bool_and(id::text <> :'reblock_asg_id')::text, bool_and(read_at is null)::text,
                 bool_and(actioned_at is null)::text, bool_and(immediate_email_sent_at is null)::text)
     from public.notifications where to_user_id = :'u_asg' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  '1|true|true|true|true');
select test.check('same_block_again_updates_message',
  (select payload->>'message' from public.notifications
    where to_user_id = :'u_req' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  '修正依頼: 二度目の理由');
rollback;

-- -----------------------------------------------------------------------------
-- 承認してから同じ人が差し戻す: その人が同じ依頼で出した承認のお知らせのうち、未読の行を消す
-- （既読の行・ほかの承認者の承認のお知らせ・ほかの依頼の承認のお知らせは残す）
-- -----------------------------------------------------------------------------
-- 承認者1人: 承認 → 押し間違いに気づいて差し戻し。「そろいました」は消え、差し戻しだけが残る
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T1');
select test.recipients(:'T1', 'review_approved') as approved_before_block \gset
select test.check('same_approver_can_block_right_after_approve', test.block(:'u_rv1', :'T1', '押し間違えました'), 'ok');
select test.check('chg_block_removes_unread_approve_notice',
  format('%s>%s|%s', :'approved_before_block', test.recipients(:'T1', 'review_approved'), test.recipients(:'T1', 'ball_passed')),
  'asg,req>|asg,req');
rollback;

-- 依頼した人は読んだ・担当者は未読: 担当者の行だけ消え、依頼した人の行は同じ id・同じ既読の時刻で残る
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T1');
update public.notifications set read_at = '2026-09-15 01:00:00+00'
 where to_user_id = :'u_req' and type = 'review_approved' and payload->>'task_id' = :'T1';
select coalesce((select format('%s|%s', id, read_at) from public.notifications
                  where to_user_id = :'u_req' and type = 'review_approved' and payload->>'task_id' = :'T1'), 'none')
       as read_approve_before \gset
select test.block(:'u_rv1', :'T1', '押し間違えました');
select test.check('chg_block_keeps_read_approve_notice',
  (select coalesce(string_agg(format('%s=%s|%s', p.label, n.id, n.read_at), ',' order by p.label), '')
     from public.notifications n join test.people p on p.id = n.to_user_id
    where n.type = 'review_approved' and n.payload->>'task_id' = :'T1'),
  'req=' || :'read_approve_before');
rollback;

-- ほかの承認者（rv2）の承認のお知らせと、同じ人（rv1）のほかの依頼（T2）の承認のお知らせは消さない
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.open(:'T2', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv2', :'T1');
select test.approve(:'u_rv1', :'T1');
select test.approve(:'u_rv1', :'T2');
select test.block(:'u_rv1', :'T1', '押し間違えました');
select test.check('chg_block_keeps_other_approvers_notice',
  (select coalesce(string_agg(p.label || '=' || n.dedupe_key, ',' order by p.label), '')
     from public.notifications n join test.people p on p.id = n.to_user_id
    where n.type = 'review_approved' and n.payload->>'task_id' = :'T1'),
  format('asg=review_approve:%1$s:%2$s:%3$s,req=review_approve:%1$s:%2$s:%4$s', test.review_id(:'T1'), :'u_rv2', :'u_asg', :'u_req'));
select test.check('chg_block_keeps_other_review_approve_notice', test.recipients(:'T2', 'review_approved'), 'req');
rollback;

-- -----------------------------------------------------------------------------
-- CLI / MCP の道具（rpc_review_approve_as / rpc_review_block_as）でも同じ（同じ本体を通る）
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('same_cli_approve_ok',
  test.act_service(format('select public.rpc_review_approve_as(%L::uuid, %L::uuid, null)', :'u_rv1', :'T1')), 'ok');
select test.check('chg_cli_approve_notifies', test.recipients(:'T1', 'review_approved'), 'asg,req');
select test.check('chg_cli_approve_key',
  (select dedupe_key from public.notifications where to_user_id = :'u_req' and type = 'review_approved' and payload->>'task_id' = :'T1'),
  format('review_approve:%s:%s:%s', test.review_id(:'T1'), :'u_rv1', :'u_req'));
rollback;

begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('same_cli_block_ok',
  test.act_service(format('select public.rpc_review_block_as(%L::uuid, %L::uuid, %L, null)', :'u_rv1', :'T1', 'CLIから直して')), 'ok');
select test.check('chg_cli_block_notifies', test.recipients(:'T1', 'ball_passed'), 'asg,req');
rollback;

-- -----------------------------------------------------------------------------
-- お知らせを書けなくても、承認・差し戻しそのものは成功する
-- （代役: 承認・差し戻しのお知らせの insert / update を止めるトリガーを、このトランザクションの中だけ付ける）
-- -----------------------------------------------------------------------------
create or replace function test.refuse_result_notice()
returns trigger language plpgsql as $$
begin
  if new.type in ('review_approved', 'ball_passed') then
    raise exception 'test: お知らせの書き込みを止めました';
  end if;
  return new;
end $$;

begin;
create trigger test_refuse_result_notice before insert or update on public.notifications
  for each row execute function test.refuse_result_notice();
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('same_approve_succeeds_when_notice_fails', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('same_approve_keeps_result_when_notice_fails',
  (select format('%s|%s|%s',
     (select status from public.reviews where task_id = :'T1'),
     (select count(*) from public.task_events where task_id = :'T1' and action = 'REVIEW_APPROVE'),
     (select count(*) from public.notifications where type = 'review_approved' and payload->>'task_id' = :'T1'))),
  'approved|1|0');
rollback;

begin;
create trigger test_refuse_result_notice before insert or update on public.notifications
  for each row execute function test.refuse_result_notice();
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('chg_block_succeeds_when_notice_fails', test.block(:'u_rv1', :'T1', '直してください'), 'ok');
select test.check('chg_block_keeps_result_when_notice_fails',
  (select format('%s|%s|%s|%s',
     (select status from public.reviews where task_id = :'T1'),
     (select ball from public.tasks where id = :'T1'),
     (select count(*) from public.task_events where task_id = :'T1' and action = 'REVIEW_BLOCK'),
     (select count(*) from public.notifications where type = 'ball_passed' and payload->>'task_id' = :'T1'))),
  'changes_requested|internal|1|0');
rollback;

-- 2回目の差し戻しでお知らせを書けなかったら、前のお知らせは消えずに残る
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.block(:'u_rv1', :'T1', '最初の理由');
select coalesce(string_agg(format('%s|%s|%s|%s', id, to_user_id, dedupe_key, payload->>'message'), ',' order by id), '')
         as before_refused_reblock
  from public.notifications where type = 'ball_passed' and payload->>'task_id' = :'T1' \gset
create trigger test_refuse_result_notice before insert or update on public.notifications
  for each row execute function test.refuse_result_notice();
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('chg_block_again_succeeds_when_notice_fails', test.block(:'u_rv1', :'T1', '二度目の理由'), 'ok');
select test.check('same_block_again_keeps_old_notice_when_notice_fails',
  (select coalesce(string_agg(format('%s|%s|%s|%s', id, to_user_id, dedupe_key, payload->>'message'), ',' order by id), '')
     from public.notifications where type = 'ball_passed' and payload->>'task_id' = :'T1'),
  :'before_refused_reblock');
select test.check('same_block_again_old_notice_is_first_reason',
  (select string_agg(payload->>'message', ',') from public.notifications
    where to_user_id = :'u_req' and type = 'ball_passed' and payload->>'task_id' = :'T1'),
  '修正依頼: 最初の理由');
rollback;

-- 承認のあとの差し戻しでお知らせを書けなかったら、未読の承認のお知らせも消えずに残る（消した行も元に戻る）
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.approve(:'u_rv1', :'T1');
create trigger test_refuse_result_notice before insert or update on public.notifications
  for each row execute function test.refuse_result_notice();
select test.check('chg_block_after_approve_succeeds_when_notice_fails', test.block(:'u_rv1', :'T1', '押し間違えました'), 'ok');
select test.check('chg_block_keeps_approve_notice_when_notice_fails', test.recipients(:'T1', 'review_approved'), 'asg,req');
rollback;

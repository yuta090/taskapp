-- =============================================================================
-- 「社内承認がそろったらタスクを完了にする」（*_review_auto_complete.sql）の挙動検証
-- 前提: run_review_auto_complete.sh が migrations → review_auto_complete_seed.sql →（GREEN なら）本 migration を
--       適用済み。人物・タスクは review_auto_complete_seed.sql と review_result_notify_seed.sql を参照。
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
\set T1  'd0000000-0000-0000-0000-000000000001'
\set T9  'd0000000-0000-0000-0000-000000000009'
\set T10 'd0000000-0000-0000-0000-000000000010'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ（review_result_notify_assert.sql と同じ形）
-- -----------------------------------------------------------------------------
create schema if not exists test;

create table if not exists test.people (id uuid primary key, label text not null);
insert into test.people (id, label) values
  (:'u_req', 'req'), (:'u_rv1', 'rv1'), (:'u_rv2', 'rv2'), (:'u_asg', 'asg'), (:'u_cl', 'cl')
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

-- p_user として（authenticated・request.jwt.claims の sub）SQL を1つ実行し、postgres に戻る
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

-- 承認して、rpc の戻り値（jsonb）そのものを読む。失敗したら 'error:<SQLSTATE>'
create or replace function test.approve_result(p_user uuid, p_task uuid)
returns text language plpgsql as $$
declare
  v_res jsonb;
  v_state text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute format('select public.rpc_review_approve(%L::uuid, null)', p_task) into v_res;
    execute 'reset role';
    return v_res::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    return 'error:' || v_state;
  end;
end $$;

create or replace function test.task_status(p_task uuid)
returns text language sql as $$
  select status from public.tasks where id = p_task;
$$;

-- そのタスクに残った監査ログ（種類・対象・要約・前後の状態・押した人・その人の組織の役割）
create or replace function test.audit_of(p_task uuid)
returns text language sql as $$
  select coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s',
                                    a.event_type, a.target_type, a.summary,
                                    a.data_before->>'status', a.data_after->>'status',
                                    coalesce(p.label, a.actor_id::text), a.actor_role, a.visibility),
                             ',' order by a.occurred_at), '')
    from public.audit_logs a
    left join test.people p on p.id = a.actor_id
   where a.target_id = p_task;
$$;

-- そのタスクの review_approved のお知らせ1行分（見出し・本文・そろったか・完了にしたか）
create or replace function test.approved_notice(p_task uuid, p_to uuid)
returns text language sql as $$
  select format('%s|%s|%s|%s', payload->>'title', payload->>'message',
                payload->>'all_approved', coalesce(payload->>'task_completed', '(none)'))
    from public.notifications
   where type = 'review_approved' and to_user_id = p_to and payload->>'task_id' = p_task::text;
$$;

-- 誰の承認で作られたお知らせかを、キー（review_approve:<依頼>:<承認した人>:<宛先>）で選ぶ。
-- 承認者が複数いると宛先1人に複数行たまるので、承認者を指定しないと行が定まらない
create or replace function test.approved_notice_from(p_task uuid, p_to uuid, p_actor uuid)
returns text language sql as $$
  select format('%s|%s|%s|%s', n.payload->>'title', n.payload->>'message',
                n.payload->>'all_approved', coalesce(n.payload->>'task_completed', '(none)'))
    from public.notifications n
    join public.reviews r on r.task_id = p_task
   where n.type = 'review_approved' and n.to_user_id = p_to
     and n.dedupe_key = format('review_approve:%s:%s:%s', r.id, p_actor, p_to);
$$;

-- そのタスクの task_events の REVIEW_APPROVE 1行分
create or replace function test.approve_event(p_task uuid)
returns text language sql as $$
  select format('%s|%s|%s', action, payload->>'allApproved', coalesce(payload->>'autoCompleted', '(none)'))
    from public.task_events
   where task_id = p_task and action = 'REVIEW_APPROVE'
   order by created_at desc limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 形: 本体の実行権・SECURITY DEFINER・search_path は土台のまま（外からは誰も呼べない）
-- -----------------------------------------------------------------------------
select test.check('same_impl_rights',
  (select format('%s definer=%s config=%s public=%s anon=%s authenticated=%s service_role=%s',
                 p.proname, p.prosecdef::text, array_to_string(p.proconfig, ';'),
                 has_function_privilege('public', p.oid, 'execute')::text,
                 has_function_privilege('anon', p.oid, 'execute')::text,
                 has_function_privilege('authenticated', p.oid, 'execute')::text,
                 has_function_privilege('service_role', p.oid, 'execute')::text)
     from pg_proc p where p.oid = to_regprocedure('public._review_approve_impl(uuid,uuid,uuid)')),
  '_review_approve_impl definer=true config=search_path=public public=false anon=false authenticated=false service_role=false');

-- -----------------------------------------------------------------------------
-- 1) 承認者が1人。承認したらそのままタスクが完了になる
-- -----------------------------------------------------------------------------
begin;
select test.check('same_requester_can_open', test.open(:'T1', array[:'u_rv1']::uuid[]), 'ok');
select test.check('chg_approve_returns_task_completed', test.approve_result(:'u_rv1', :'T1'),
  '{"ok": true, "allApproved": true, "taskCompleted": true}');
select test.check('chg_task_is_done_after_all_approved', test.task_status(:'T1'), 'done');
select test.check('same_review_is_approved', (select status from public.reviews where task_id = :'T1'), 'approved');
select test.check('same_approval_is_approved',
  (select string_agg(ra.state, ',') from public.review_approvals ra
     join public.reviews r on r.id = ra.review_id where r.task_id = :'T1'), 'approved');
select test.check('chg_completed_at_is_set',
  (select (completed_at is not null)::text from public.tasks where id = :'T1'), 'true');
select test.check('chg_task_event_records_auto_complete', test.approve_event(:'T1'), 'REVIEW_APPROVE|true|true');
select test.check('chg_audit_log_records_auto_complete', test.audit_of(:'T1'),
  'task.status_changed|task|社内承認がそろったので完了にしました|in_review|done|rv1|member|team');
select test.check('chg_notice_says_completed', test.approved_notice(:'T1', :'u_req'),
  '社内承認がそろい、完了にしました: 「承認と差し戻しのタスク」|すべての承認者が承認したので、タスクを完了にしました。|true|true');
rollback;

-- -----------------------------------------------------------------------------
-- 2) 承認者が2人。1人目ではまだ完了にしない。2人目でそろって完了になる
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.check('same_first_of_two_approve_ok', test.approve(:'u_rv1', :'T1'), 'ok');
-- 依頼を出した時点で rpc_review_open がタスクを「社内承認中」にしている
select test.check('same_first_of_two_not_done', test.task_status(:'T1'), 'in_review');
select test.check('same_first_of_two_review_open', (select status from public.reviews where task_id = :'T1'), 'open');
select test.check('same_first_of_two_no_audit', test.audit_of(:'T1'), '');
select test.check('chg_second_of_two_done', (select test.task_status(:'T1') from (select test.approve(:'u_rv2', :'T1')) _), 'done');
select test.check('chg_second_of_two_notice', test.approved_notice_from(:'T1', :'u_asg', :'u_rv2'),
  '社内承認がそろい、完了にしました: 「承認と差し戻しのタスク」|すべての承認者が承認したので、タスクを完了にしました。|true|true');
rollback;

-- -----------------------------------------------------------------------------
-- 3) 未決の決定事項タスクは完了にしない（承認そのものは通る）
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T9', array[:'u_rv1']::uuid[]);
select test.check('same_spec_approve_ok', test.approve(:'u_rv1', :'T9'), 'ok');
select test.check('same_spec_task_not_done', test.task_status(:'T9'), 'in_review');
select test.check('same_spec_review_approved', (select status from public.reviews where task_id = :'T9'), 'approved');
select test.check('same_spec_no_audit', test.audit_of(:'T9'), '');
select test.check('chg_spec_notice_says_why', test.approved_notice(:'T9', :'u_req'),
  '社内承認がそろいました: 「未決の決定事項」|すべての承認者が承認しました。決定事項がまだ決まっていないので、完了にはしていません。先に「決定にする」を押してください。|true|false');
rollback;

begin;
select test.open(:'T9', array[:'u_rv1']::uuid[]);
select test.check('chg_spec_returns_task_completed_false', test.approve_result(:'u_rv1', :'T9'),
  '{"ok": true, "allApproved": true, "taskCompleted": false}');
rollback;

-- -----------------------------------------------------------------------------
-- 4) すでに完了しているタスクは触らない
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T10', array[:'u_rv1']::uuid[]);
select test.check('same_done_task_approve_ok', test.approve(:'u_rv1', :'T10'), 'ok');
select test.check('same_done_task_stays_done', test.task_status(:'T10'), 'done');
select test.check('same_done_task_no_audit', test.audit_of(:'T10'), '');
select test.check('chg_done_task_notice', test.approved_notice(:'T10', :'u_req'),
  '社内承認がそろいました: 「もう完了しているタスク」|すべての承認者が承認しました。このタスクはすでに完了しています。|true|false');
rollback;

-- -----------------------------------------------------------------------------
-- 5) 差し戻しでは完了にしない
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('same_block_ok', test.block(:'u_rv1', :'T1', '内容を直してください'), 'ok');
select test.check('same_block_not_done', test.task_status(:'T1'), 'in_review');
select test.check('same_block_no_audit', test.audit_of(:'T1'), '');
rollback;

-- -----------------------------------------------------------------------------
-- 6) すでに承認した人がもう一度押しても、完了にも監査ログにも波及しない
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T1', array[:'u_rv1', :'u_rv2']::uuid[]);
select test.approve(:'u_rv1', :'T1');
select test.check('same_reapprove_ok', test.approve(:'u_rv1', :'T1'), 'ok');
select test.check('same_reapprove_not_done', test.task_status(:'T1'), 'in_review');
select test.check('same_reapprove_no_audit', test.audit_of(:'T1'), '');
rollback;

-- -----------------------------------------------------------------------------
-- 7) 承認できない人が押しても、タスクは動かない
-- -----------------------------------------------------------------------------
begin;
select test.open(:'T1', array[:'u_rv1']::uuid[]);
select test.check('same_not_reviewer_error', test.approve(:'u_asg', :'T1'),
  'error:P0001:User is not a reviewer for this task');
select test.check('same_not_reviewer_not_done', test.task_status(:'T1'), 'in_review');
select test.check('same_client_not_authorized', test.approve(:'u_cl', :'T1'),
  'error:P0001:Not authorized to access this review');
select test.check('same_client_not_done', test.task_status(:'T1'), 'in_review');
rollback;

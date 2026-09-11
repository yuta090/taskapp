-- =============================================================================
-- 社内承認の依頼の通知（*_review_request_notify.sql）の挙動検証
-- 前提: run_review_request_notify.sh が migrations → review_request_notify_seed.sql →（GREEN なら）本 migration を
--       適用済み。人物・データは review_request_notify_seed.sql を参照。
--
-- label:
--   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS）
--   same_*  変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]（ハーネスが数える）。
--   RPC を呼ぶ確認は1つずつ begin … rollback で包み、互いに影響させない。
-- =============================================================================
set client_min_messages = notice;

\set O1 'a0000000-0000-0000-0000-000000000001'
\set S1 'b0000000-0000-0000-0000-000000000001'
\set u_req  'c0000000-0000-0000-0000-000000000001'
\set u_rv1  'c0000000-0000-0000-0000-000000000002'
\set u_rv2  'c0000000-0000-0000-0000-000000000003'
\set u_rv3  'c0000000-0000-0000-0000-000000000004'
\set u_vw   'c0000000-0000-0000-0000-000000000005'
\set u_cl   'c0000000-0000-0000-0000-000000000006'
\set u_gone 'c0000000-0000-0000-0000-000000000007'
\set T1 'd0000000-0000-0000-0000-000000000001'
\set T2 'd0000000-0000-0000-0000-000000000002'
\set T3 'd0000000-0000-0000-0000-000000000003'
\set T4 'd0000000-0000-0000-0000-000000000004'
\set T5 'd0000000-0000-0000-0000-000000000005'
\set R1 'e0000000-0000-0000-0000-000000000001'
\set R2 'e0000000-0000-0000-0000-000000000002'
\set R3 'e0000000-0000-0000-0000-000000000003'
\set R5 'e0000000-0000-0000-0000-000000000005'

-- 依頼・承認・差し戻し・取り消しの SQL（test.act に渡す）
\set open_rv1      'select public.rpc_review_open(''d0000000-0000-0000-0000-000000000004''::uuid, ''{c0000000-0000-0000-0000-000000000002}''::uuid[])'
\set open_rv1_rv2  'select public.rpc_review_open(''d0000000-0000-0000-0000-000000000004''::uuid, ''{c0000000-0000-0000-0000-000000000002,c0000000-0000-0000-0000-000000000003}''::uuid[])'
\set open_rv1_req  'select public.rpc_review_open(''d0000000-0000-0000-0000-000000000004''::uuid, ''{c0000000-0000-0000-0000-000000000002,c0000000-0000-0000-0000-000000000001}''::uuid[])'
\set open_vw       'select public.rpc_review_open(''d0000000-0000-0000-0000-000000000004''::uuid, ''{c0000000-0000-0000-0000-000000000005}''::uuid[])'
\set approve_t4    'select public.rpc_review_approve(''d0000000-0000-0000-0000-000000000004''::uuid, null)'
\set block_t4      'select public.rpc_review_block(''d0000000-0000-0000-0000-000000000004''::uuid, ''直してください'', null)'
\set cancel_t4     'select public.rpc_review_cancel((select id from public.reviews where task_id = ''d0000000-0000-0000-0000-000000000004''::uuid))'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;

create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql as $$
begin
  if p_got is not distinct from p_want then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
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

-- T4 の、指定した人あての依頼のお知らせ（件数|未読か|未対応か|即時メール未送信か）
create or replace function test.t4_notice(p_user uuid)
returns text language sql as $$
  select format('%s|%s|%s|%s', count(*), bool_and(read_at is null)::text, bool_and(actioned_at is null)::text,
                bool_and(immediate_email_sent_at is null)::text)
    from public.notifications
   where to_user_id = p_user and type = 'review_request' and channel = 'in_app'
     and payload->>'task_id' = 'd0000000-0000-0000-0000-000000000004';
$$;

-- -----------------------------------------------------------------------------
-- 節 3: 通知が届いていない保留中の承認に、受信トレイの通知を後から足す
-- -----------------------------------------------------------------------------
select test.check('chg_backfill_notice_for_pending_reviewer',
  (select format('%s|%s|%s|%s', type, channel, (read_at is null)::text, payload->>'task_id')
     from public.notifications
    where to_user_id = :'u_rv1' and dedupe_key = format('review_request:%s:%s', :'R1', :'u_rv1')),
  format('review_request|in_app|true|%s', :'T1'));

-- 受信トレイで正しい位置に並ぶよう、依頼された時刻で入れる
select test.check('chg_backfill_keeps_request_time',
  (select (n.created_at = '2026-09-10 09:21:38+00')::text
     from public.notifications n
    where n.to_user_id = :'u_rv1' and n.dedupe_key = format('review_request:%s:%s', :'R1', :'u_rv1')),
  'true');

-- 後から足した分はメールで送らない（即時メールの定期実行も、毎朝のまとめも immediate_email_sent_at が空のものだけ拾う）
select test.check('chg_backfill_skips_email',
  (select (immediate_email_sent_at is not null)::text
     from public.notifications
    where to_user_id = :'u_rv1' and dedupe_key = format('review_request:%s:%s', :'R1', :'u_rv1')),
  'true');

select test.check('chg_backfill_notice_text',
  (select format('%s|%s|%s', payload->>'title', payload->>'from_user_name', payload->>'source')
     from public.notifications
    where to_user_id = :'u_rv1' and dedupe_key = format('review_request:%s:%s', :'R1', :'u_rv1')),
  '社内承認の依頼: 「承認してほしいタスク」|依頼する人|backfill_20260911');

select test.check('same_backfill_skips_requester',
  (select count(*)::text from public.notifications where to_user_id = :'u_req'), '0');
select test.check('same_backfill_skips_approved_reviewer',
  (select count(*)::text from public.notifications where to_user_id = :'u_rv3'), '0');
select test.check('same_backfill_skips_cancelled_review',
  (select count(*)::text from public.notifications
    where dedupe_key = format('review_request:%s:%s', :'R2', :'u_rv1')), '0');
-- 今は承認者になれない人（相手先・プロジェクトから外された人）には出さない（社内のタスク名を見せない）
select test.check('same_backfill_skips_client_reviewer',
  (select count(*)::text from public.notifications where to_user_id = :'u_cl'), '0');
select test.check('same_backfill_skips_removed_member',
  (select count(*)::text from public.notifications where to_user_id = :'u_gone'), '0');
-- アーカイブしたプロジェクトの依頼は出さない
select test.check('same_backfill_skips_archived_project',
  (select count(*)::text from public.notifications
    where dedupe_key = format('review_request:%s:%s', :'R5', :'u_rv1')), '0');
select test.check('same_backfill_keeps_existing_notice',
  (select format('%s|%s|%s', count(*), bool_and(read_at = '2026-09-02 00:00:00+00')::text, bool_and(created_at = '2026-09-01 00:00:00+00')::text)
     from public.notifications where to_user_id = :'u_rv2'),
  '1|true|true');
-- 追加の間だけ止めたプッシュのトリガーは、終わったら動いている
select test.check('same_push_trigger_enabled',
  (select tgenabled::text from pg_trigger
    where tgname = 'notifications_push_dispatch' and tgrelid = 'public.notifications'::regclass), 'O');

-- -----------------------------------------------------------------------------
-- 節 1: rpc_review_open が、承認を頼まれた人に通知を作る（依頼した本人には作らない）
-- -----------------------------------------------------------------------------
begin;
select test.check('same_editor_can_request', test.act(:'u_req', :'open_rv1_req'), 'ok');
-- 依頼のときの通知は、ふつうどおりメール・プッシュの対象（後から足す分と違って印を立てない）
select test.check('chg_request_notifies_reviewer', test.t4_notice(:'u_rv1'), '1|true|true|true');
select test.check('chg_request_notice_text',
  (select format('%s|%s|%s', payload->>'title', payload->>'from_user_name', payload->>'task_title') from public.notifications
    where to_user_id = :'u_rv1' and type = 'review_request' and payload->>'task_id' = :'T4'),
  '社内承認の依頼: 「まだ依頼していないタスク」|依頼する人|まだ依頼していないタスク');
select test.check('same_request_no_notice_to_requester',
  (select count(*)::text from public.notifications where to_user_id = :'u_req' and payload->>'task_id' = :'T4'), '0');
rollback;

-- 受信トレイで差し戻したあと、もう一度依頼したら、新しい依頼として出し直す（未読・要対応に戻し、メールも送り直す）
begin;
select test.act(:'u_req', :'open_rv1');
update public.notifications set read_at = now(), actioned_at = now(), immediate_email_sent_at = now()
 where to_user_id = :'u_rv1' and payload->>'task_id' = :'T4';
select test.check('same_reviewer_can_return', test.act(:'u_rv1', :'block_t4'), 'ok');
select test.check('same_requester_can_request_again', test.act(:'u_req', :'open_rv1'), 'ok');
select test.check('chg_request_again_renews_notice', test.t4_notice(:'u_rv1'), '1|true|true|true');
rollback;

-- ほかの人を加えて依頼し直しても、まだ返事をしていない人にはメールを送り直さない（受信トレイでは上に出す）
begin;
select test.act(:'u_req', :'open_rv1');
update public.notifications set read_at = now(), immediate_email_sent_at = '2026-09-11 00:00:00+00'
 where to_user_id = :'u_rv1' and payload->>'task_id' = :'T4';
select test.check('same_requester_can_add_reviewer', test.act(:'u_req', :'open_rv1_rv2'), 'ok');
select test.check('chg_add_reviewer_resurfaces_without_email',
  (select format('%s|%s|%s', count(*), bool_and(read_at is null)::text, bool_and(immediate_email_sent_at = '2026-09-11 00:00:00+00')::text)
     from public.notifications where to_user_id = :'u_rv1' and type = 'review_request' and payload->>'task_id' = :'T4'),
  '1|true|true');
select test.check('chg_added_reviewer_notified', test.t4_notice(:'u_rv2'), '1|true|true|true');
rollback;

-- 閲覧者は依頼できない（本 migration では変えない）。止まったら通知も作られない
begin;
select test.check('same_viewer_cannot_request', left(test.act(:'u_vw', :'open_rv1'), 11), 'error:P0001');
select test.check('same_viewer_request_makes_no_notice',
  (select count(*)::text from public.notifications where payload->>'task_id' = :'T4'), '0');
rollback;

-- 承認者は社内の admin / editor だけ（本 migration では変えない）
begin;
select test.check('same_viewer_cannot_be_reviewer', left(test.act(:'u_req', :'open_vw'), 11), 'error:P0001');
rollback;

-- 書き込める役割の確認（space_role_boundary で足したもの）は残っている
select test.check('same_request_keeps_write_check',
  (select (position('app_can_write_space' in p.prosrc) > 0)::text
     from pg_proc p where p.oid = 'public.rpc_review_open(uuid,uuid[],uuid)'::regprocedure),
  'true');

-- -----------------------------------------------------------------------------
-- 節 2: 承認者の返事に合わせて、依頼のお知らせを片付ける（どの画面から返事をしても同じ）
-- -----------------------------------------------------------------------------
-- 承認したら（タスク詳細から返事をしても）、本人の依頼のお知らせは既読・対応済みになる。ほかの承認者のものはそのまま
begin;
select test.act(:'u_req', :'open_rv1_rv2');
select test.check('same_reviewer_can_approve', test.act(:'u_rv1', :'approve_t4'), 'ok');
select test.check('chg_approve_settles_notice',
  (select format('%s|%s|%s', count(*), bool_and(read_at is not null)::text, bool_and(actioned_at is not null)::text)
     from public.notifications where to_user_id = :'u_rv1' and type = 'review_request' and payload->>'task_id' = :'T4'),
  '1|true|true');
select test.check('chg_approve_keeps_other_reviewer_notice', test.t4_notice(:'u_rv2'), '1|true|true|true');
rollback;

-- 差し戻しでも、本人の依頼のお知らせは既読・対応済みになる
begin;
select test.act(:'u_req', :'open_rv1');
select test.act(:'u_rv1', :'block_t4');
select test.check('chg_return_settles_notice',
  (select format('%s|%s|%s', count(*), bool_and(read_at is not null)::text, bool_and(actioned_at is not null)::text)
     from public.notifications where to_user_id = :'u_rv1' and type = 'review_request' and payload->>'task_id' = :'T4'),
  '1|true|true');
rollback;

-- 取り消したら、まだ返事をしていない人の依頼のお知らせは消え、返事をした人のもの（履歴）は残る
begin;
select test.act(:'u_req', :'open_rv1_rv2');
select test.act(:'u_rv2', :'approve_t4');
select test.check('same_requester_can_cancel', test.act(:'u_req', :'cancel_t4'), 'ok');
select test.check('chg_cancel_removes_unanswered_notice',
  (select format('%s|%s',
     (select count(*) from public.notifications where to_user_id = :'u_rv1' and type = 'review_request' and payload->>'task_id' = :'T4'),
     (select count(*) from public.notifications where to_user_id = :'u_rv2' and type = 'review_request' and payload->>'task_id' = :'T4'))),
  '0|1');
rollback;

-- 承認者から外したら、その人のまだ返事をしていない依頼のお知らせは消える
begin;
select test.act(:'u_req', :'open_rv1_rv2');
select test.check('same_requester_can_remove_reviewer', test.act(:'u_req', :'open_rv1'), 'ok');
select test.check('chg_removed_reviewer_notice_removed',
  (select format('%s|%s',
     (select count(*) from public.notifications where to_user_id = :'u_rv1' and type = 'review_request' and payload->>'task_id' = :'T4'),
     (select count(*) from public.notifications where to_user_id = :'u_rv2' and type = 'review_request' and payload->>'task_id' = :'T4'))),
  '1|0');
rollback;

-- 片付けの関数はトリガーからだけ動く（利用者が直接呼べない）
select test.check('chg_settle_functions_trigger_only',
  (select format('%s|%s',
     coalesce(has_function_privilege('authenticated', to_regprocedure('public.app_review_approval_settle_notice()'), 'execute')::text, 'none'),
     coalesce(has_function_privilege('authenticated', to_regprocedure('public.app_review_cancel_settle_notice()'), 'execute')::text, 'none'))),
  'false|false');

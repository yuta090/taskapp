-- rpc_create_instant_digest_task アサーション（ON_ERROR_STOP=1 で流す）
\set ON_ERROR_STOP on

set client_min_messages = warning;

-- helper: 1行取り出し
-- ---------------------------------------------------------------------------
-- Case 1: approver設定＋space紐付け → is_pending=true・promotion_state='pending'・requested_to=現approver
-- ---------------------------------------------------------------------------
do $$
declare r record; t record;
begin
  select * into r from public.rpc_create_instant_digest_task(
    '11111111-1111-4111-8111-111111111111',           -- g_pending
    '00000000-0000-4000-8000-0000000000a1',            -- source_message_id
    '見積提出', '山田', 'U-yamada', null, '2026-07-20', '10:00');

  if r.id is null then raise exception 'case1: expected non-null id'; end if;
  if r.is_pending is not true then raise exception 'case1: expected is_pending=true, got %', r.is_pending; end if;
  if r.is_duplicate is not false then raise exception 'case1: expected is_duplicate=false'; end if;

  select * into t from public.channel_digest_tasks where id = r.id;
  if t.promotion_state <> 'pending' then raise exception 'case1: promotion_state=% (want pending)', t.promotion_state; end if;
  if t.requested_to_user_id <> 'a1111111-1111-4111-8111-111111111111' then raise exception 'case1: requested_to mismatch'; end if;
  if t.requested_at is null then raise exception 'case1: requested_at must be set (CHECK)'; end if;
  if t.approval_notified_at is not null then raise exception 'case1: approval_notified_at must be null at creation'; end if;
  if t.space_id <> '50000000-0000-4000-8000-000000000001' then raise exception 'case1: space_id derived from locked row'; end if;
  if t.org_id <> '01111111-1111-4111-8111-111111111111' then raise exception 'case1: org_id derived from locked row'; end if;
  if t.extracted_date <> (now() at time zone 'Asia/Tokyo')::date then raise exception 'case1: extracted_date must be JST today'; end if;
  if t.assignee_hint <> '山田' or t.assignee_external_user_id <> 'U-yamada' then raise exception 'case1: assignee fields'; end if;
  if t.due_date <> '2026-07-20' or t.due_time <> '10:00' then raise exception 'case1: due fields'; end if;
  raise notice 'case1 OK';
end $$;

-- ---------------------------------------------------------------------------
-- Case 2: approver未設定 → is_pending=false・promotion_state='none'・requested系はnull
-- ---------------------------------------------------------------------------
do $$
declare r record; t record;
begin
  select * into r from public.rpc_create_instant_digest_task(
    '22222222-2222-4222-8222-222222222222',           -- g_noapp
    '00000000-0000-4000-8000-0000000000a2', '在庫確認', null, null, null, null, null);

  if r.is_pending is not false then raise exception 'case2: expected is_pending=false'; end if;
  if r.is_duplicate is not false then raise exception 'case2: expected is_duplicate=false'; end if;
  select * into t from public.channel_digest_tasks where id = r.id;
  if t.promotion_state <> 'none' then raise exception 'case2: promotion_state=% (want none)', t.promotion_state; end if;
  if t.requested_to_user_id is not null then raise exception 'case2: requested_to must be null'; end if;
  if t.requested_at is not null then raise exception 'case2: requested_at must be null'; end if;
  raise notice 'case2 OK';
end $$;

-- ---------------------------------------------------------------------------
-- Case 3: approver設定でもspace未紐付け → is_pending=false（夜間ingestと同条件: approver かつ space）
-- ---------------------------------------------------------------------------
do $$
declare r record; t record;
begin
  select * into r from public.rpc_create_instant_digest_task(
    '33333333-3333-4333-8333-333333333333',           -- g_nospace
    '00000000-0000-4000-8000-0000000000a3', '請求書確認', null, null, null, null, null);

  if r.is_pending is not false then raise exception 'case3: expected is_pending=false (space未紐付け)'; end if;
  select * into t from public.channel_digest_tasks where id = r.id;
  if t.promotion_state <> 'none' then raise exception 'case3: promotion_state=% (want none)', t.promotion_state; end if;
  if t.space_id is not null then raise exception 'case3: space_id must be null'; end if;
  raise notice 'case3 OK';
end $$;

-- ---------------------------------------------------------------------------
-- Case 4: 重複(source_message_id,title) → is_duplicate=true・id=null・行は増えない・is_pendingは現在値
-- ---------------------------------------------------------------------------
do $$
declare r record; cnt_before int; cnt_after int;
begin
  select count(*) into cnt_before from public.channel_digest_tasks;
  -- Case1 と同じ (source_message_id, title) を再投入（webhook再送）
  select * into r from public.rpc_create_instant_digest_task(
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000a1', '見積提出', '別人', 'U-other', null, null, null);

  if r.id is not null then raise exception 'case4: duplicate must return null id'; end if;
  if r.is_duplicate is not true then raise exception 'case4: expected is_duplicate=true'; end if;
  -- is_pending は *既存タスクの実状態* を反映する。case1 の行は pending のまま → true
  if r.is_pending is not true then raise exception 'case4: is_pending should reflect existing task state (pending)'; end if;
  select count(*) into cnt_after from public.channel_digest_tasks;
  if cnt_after <> cnt_before then raise exception 'case4: row count changed on duplicate (% -> %)', cnt_before, cnt_after; end if;
  raise notice 'case4 OK';
end $$;

-- ---------------------------------------------------------------------------
-- Case 4b: 重複だが既存タスクが none に戻されている → is_pending は *実状態*(false) を返す
--   （承認者変更で pending→none に戻された行の再送。現グループ設定が pending 条件でも実状態を優先）
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  -- case1 の行(見積提出)を none に戻す（承認者変更で宙吊り解消された状態を模す）
  update public.channel_digest_tasks
     set promotion_state = 'none', requested_to_user_id = null, requested_at = null
   where source_message_id = '00000000-0000-4000-8000-0000000000a1' and title = '見積提出';

  select * into r from public.rpc_create_instant_digest_task(
    '11111111-1111-4111-8111-111111111111',  -- g_pending は依然 approver+space 有り
    '00000000-0000-4000-8000-0000000000a1', '見積提出', null, null, null, null, null);

  if r.is_duplicate is not true then raise exception 'case4b: expected is_duplicate=true'; end if;
  -- 現グループ設定は pending 条件を満たすが、既存行は none。実状態(false)を返すべき
  if r.is_pending is not false then raise exception 'case4b: is_pending must reflect existing none state (false)'; end if;
  raise notice 'case4b OK';
end $$;

-- ---------------------------------------------------------------------------
-- Case 5: レース直列化 — insert前にapproverを外すと、ロックした *その時点の* 値で確定する
--   （同一TXでは検証しづらいので、ここでは「approver更新後の呼び出しは新しい値で確定」を確認）
-- ---------------------------------------------------------------------------
do $$
declare r record; t record;
begin
  -- g_pending の approver を外す（承認者交代の到達点を模す）
  update public.channel_groups set approver_user_id = null
    where id = '11111111-1111-4111-8111-111111111111';

  select * into r from public.rpc_create_instant_digest_task(
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000a5', '発注書送付', null, null, null, null, null);

  -- approver が外れた後の作成は none で確定する（旧approver宛の宙吊りpendingを作らない）
  if r.is_pending is not false then raise exception 'case5: after approver removed, must be is_pending=false'; end if;
  select * into t from public.channel_digest_tasks where id = r.id;
  if t.promotion_state <> 'none' then raise exception 'case5: promotion_state=% (want none)', t.promotion_state; end if;
  if t.requested_to_user_id is not null then raise exception 'case5: requested_to must be null'; end if;
  raise notice 'case5 OK';
end $$;

select 'ALL INSTANT-DIGEST-TASK ASSERTIONS PASSED' as result;

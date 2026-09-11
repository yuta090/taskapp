-- =============================================================================
-- 社内承認を頼まれた人の受信トレイに、依頼のお知らせ（review_request）が届くようにする
--
-- 問題（2026-09-11 本番で確認）:
--   20260703_000_collab_notifications.sql で rpc_review_open に「承認を頼まれた人（保留中）へのお知らせ」を
--   入れたが、20260705133733_rpc_review_open_internal_reviewers.sql が、お知らせの入る前の
--   20260218_000_fix_review_open_approvals.sql を土台に作り直したため、お知らせの部分が消えた。
--   20260911143112_space_role_boundary.sql もその定義を写したので、今もお知らせが作られない。
--   承認を頼まれても受信トレイに何も出ず、保留中の承認にお知らせが無いものが残っていた。
--   あわせて、承認・差し戻し・取り消しをしても依頼のお知らせが「要対応」のまま残る作りで、差し戻しのあとに
--   もう一度依頼しても、受信トレイで差し戻した人には「対応済み」のお知らせのまま届いていた。
--
-- 対応:
--   節 1: rpc_review_open を 20260911143112_space_role_boundary.sql の定義のまま写し、DECLARE の2行と、最後に
--         保留中の承認者（依頼した本人は除く）へのお知らせを足す。文面は画面の言葉（社内承認）にそろえた。
--         もう一度依頼したときは前のお知らせを出し直す（未読・要対応に戻す。前の依頼に返事をしていた人には
--         即時メールも送り直す）。呼んだ人の確認（space の admin / editor・app_can_write_space・承認者は社内の
--         admin / editor）は変えない。誰が呼べるか（実行権）は create or replace では変わらない。
--   節 2: 依頼のお知らせを、承認者の返事に合わせて片付けるトリガー（どの画面・経路から返事をしても同じになる）
--         - 承認・差し戻し（review_approvals.state が pending から変わる）→ 本人のお知らせを既読・対応済みにする
--         - 承認者から外された（review_approvals の削除）・依頼の取り消し（reviews.status → cancelled）
--           → まだ対応していないお知らせを消す（もう頼まれていない。取り消しのお知らせは rpc_review_cancel が別に送る）
--   節 3: いま保留中なのにお知らせが無いものへ、受信トレイのお知らせを足す。対象は、今も承認者になれる人だけ
--         （space の admin / editor で、組織の社内メンバー）・アーカイブしていないプロジェクトの依頼だけ。
--         - 作った時刻は、承認を頼まれた時刻（review_approvals.created_at）にする（受信トレイで正しい位置に並ぶ）
--         - メールは送らない: immediate_email_sent_at を立てる（5分おきの即時メールも、毎朝のまとめも、
--           ここが空のものだけを拾う）
--         - プッシュも送らない: 足す間だけ notifications_push_dispatch を止める（1つの DO 文の中で止めて戻すので、
--           途中で失敗しても止まったままにならない）
--         - payload.source = 'backfill_20260911' を付ける（ロールバックで、足した分だけを消せるように）
--
-- 確認: rpc_review_open の今の定義が、土台（または本 migration の定義）と1文字でも違えば止める
--       （本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）。
-- ロックを待つのは5秒まで（通知の表を止める間、ほかの書き込みを長く待たせない。取れなければ全体を取り消す）。
-- 検証: supabase/tests/run_review_request_notify.sh（RED=1 で、本 migration が無いと失敗することも確かめる）
-- =============================================================================

set local lock_timeout = '5s';

-- 確認: rpc_review_open の今の定義が、土台（20260911143112_space_role_boundary.sql）か本 migration の定義でなければ止める
do $$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_review_open(uuid,uuid[],uuid)');

  if v_md5 is null or v_md5 not in ('ecda4542ba423efc1adb5e48afd70370', 'c0ccf2b41ad8074713b34e572a575783') then
    raise exception 'review request notify: rpc_review_open の今の定義が、土台にした migration の定義と違います（md5 %）',
      coalesce(v_md5, '関数が無い');
  end if;
end $$;

-- =============================================================================
-- 節 1: rpc_review_open（土台: 20260911143112_space_role_boundary.sql。変えたのは DECLARE の2行と、最後のお知らせの節だけ）
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_open(
  p_task_id uuid,
  p_reviewer_ids uuid[],
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_existing_reviewer_ids uuid[];
  v_has_pending boolean;
  v_final_status text;
  v_actor_name text;
  v_pending_reviewer uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Sanitize reviewer IDs: remove NULLs and deduplicate
  p_reviewer_ids := ARRAY(
    SELECT DISTINCT rid FROM unnest(p_reviewer_ids) AS rid WHERE rid IS NOT NULL
  );

  -- Validate reviewers
  IF array_length(p_reviewer_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one reviewer required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Security: Verify caller is a member of the task's space (admin or editor)
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = v_task.space_id
      AND user_id = v_actor_id
      AND role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions: you must be an admin or editor in this space';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  -- Security: 社内承認のレビュアーは社内ロール（admin / editor）のみ。
  -- client / vendor ロールのメンバーは指定不可（クライアント確認はボールで行う）。
  IF EXISTS (
    SELECT rid FROM unnest(p_reviewer_ids) AS rid
    WHERE rid NOT IN (
      SELECT user_id FROM space_memberships
      WHERE space_id = v_task.space_id
        AND role IN ('admin', 'editor')
    )
  ) THEN
    RAISE EXCEPTION 'One or more reviewer IDs are not internal members (admin/editor) of this space';
  END IF;

  -- Upsert review (task_id is UNIQUE) — status determined after approval updates
  INSERT INTO reviews (org_id, space_id, task_id, status, created_by)
  VALUES (v_task.org_id, v_task.space_id, p_task_id, 'open', v_actor_id)
  ON CONFLICT (task_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_review_id;

  -- Get currently existing reviewer IDs
  SELECT COALESCE(array_agg(reviewer_id), '{}')
  INTO v_existing_reviewer_ids
  FROM review_approvals
  WHERE review_id = v_review_id;

  -- Remove reviewers no longer in the list
  DELETE FROM review_approvals
  WHERE review_id = v_review_id
    AND reviewer_id != ALL(p_reviewer_ids);

  -- Add only NEW reviewers as 'pending' (preserve existing approvals)
  INSERT INTO review_approvals (org_id, review_id, reviewer_id, state)
  SELECT v_task.org_id, v_review_id, rid, 'pending'
  FROM unnest(p_reviewer_ids) AS rid
  WHERE rid != ALL(v_existing_reviewer_ids);

  -- Reset 'blocked' reviewers back to 'pending' on re-review
  -- (approved items are preserved per REVIEW_SPEC)
  UPDATE review_approvals
  SET state = 'pending', blocked_reason = NULL, updated_at = now()
  WHERE review_id = v_review_id AND state = 'blocked';

  -- Re-evaluate review status based on current approval states
  SELECT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    v_final_status := 'open';
  ELSE
    v_final_status := 'approved';
  END IF;

  UPDATE reviews SET status = v_final_status, updated_at = now()
  WHERE id = v_review_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_OPEN',
    jsonb_build_object('reviewerIds', p_reviewer_ids)
  );

  -- 承認を頼まれた人（いま保留中の承認者全員）の受信トレイにお知らせを作る。新しく加えた人と、差し戻しから
  -- 保留中に戻った人の両方が入る。依頼した本人には作らない（20260703_000_collab_notifications.sql と同じ）。
  -- 同じ依頼のお知らせがすでにあれば、未読・要対応に戻して一番上に出す。前の依頼に返事をしていた人
  -- （差し戻し → もう一度の依頼）には、新しい依頼として即時メールも送り直す（まだ返事をしていない人には送り直さない）。
  -- 前のお知らせを書き直すので、プッシュは出ない（プッシュは新しく作ったときだけ）
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  FOR v_pending_reviewer IN
    SELECT reviewer_id FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  LOOP
    IF v_pending_reviewer <> v_actor_id THEN
      INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
      VALUES (
        v_task.org_id,
        v_task.space_id,
        v_pending_reviewer,
        'in_app',
        'review_request',
        format('review_request:%s:%s', v_review_id, v_pending_reviewer),
        jsonb_build_object(
          'task_id', p_task_id,
          'task_title', v_task.title,
          'title', format('社内承認の依頼: 「%s」', v_task.title),
          'message', '社内承認をお願いします。承認するか、理由を添えて差し戻してください。',
          'from_user_name', v_actor_name
        )
      )
      ON CONFLICT (to_user_id, channel, dedupe_key) DO UPDATE
        SET payload = excluded.payload,
            read_at = NULL,
            actioned_at = NULL,
            immediate_email_sent_at = CASE
              WHEN notifications.actioned_at IS NOT NULL THEN NULL
              ELSE notifications.immediate_email_sent_at
            END,
            created_at = now();
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- =============================================================================
-- 節 2: 依頼のお知らせを、承認者の返事に合わせて片付ける（どの画面・経路から返事をしても同じになる）
-- =============================================================================
create or replace function public.app_review_approval_settle_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- 承認者から外された: まだ対応していない依頼のお知らせを消す（もう頼まれていない）
    delete from notifications
     where to_user_id = old.reviewer_id
       and channel = 'in_app'
       and dedupe_key = format('review_request:%s:%s', old.review_id, old.reviewer_id)
       and actioned_at is null;
    return old;
  end if;

  -- 承認・差し戻しで保留中から抜けた: 本人の依頼のお知らせを既読・対応済みにする
  if old.state = 'pending' and new.state <> 'pending' then
    update notifications
       set read_at = coalesce(read_at, now()),
           actioned_at = coalesce(actioned_at, now())
     where to_user_id = new.reviewer_id
       and channel = 'in_app'
       and dedupe_key = format('review_request:%s:%s', new.review_id, new.reviewer_id);
  end if;
  return new;
end;
$$;

create or replace function public.app_review_cancel_settle_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 依頼が取り消された: まだ対応していない依頼のお知らせを消す（取り消しのお知らせは rpc_review_cancel が別に送る）
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from notifications n
     using review_approvals ra
     where ra.review_id = new.id
       and n.to_user_id = ra.reviewer_id
       and n.channel = 'in_app'
       and n.dedupe_key = format('review_request:%s:%s', new.id, ra.reviewer_id)
       and n.actioned_at is null;
  end if;
  return new;
end;
$$;

-- トリガーからだけ動かす（利用者が直接は呼べない）
revoke execute on function public.app_review_approval_settle_notice() from public, anon, authenticated;
revoke execute on function public.app_review_cancel_settle_notice() from public, anon, authenticated;

drop trigger if exists review_approvals_settle_notice on public.review_approvals;
create trigger review_approvals_settle_notice
  after update of state or delete on public.review_approvals
  for each row execute function public.app_review_approval_settle_notice();

drop trigger if exists reviews_cancel_settle_notice on public.reviews;
create trigger reviews_cancel_settle_notice
  after update of status on public.reviews
  for each row execute function public.app_review_cancel_settle_notice();

-- =============================================================================
-- 節 3: 保留中なのにお知らせが無い承認へ、受信トレイのお知らせを足す（メール・プッシュは出さない）
-- =============================================================================
do $$
begin
  -- プッシュのトリガーは足す間だけ止める（この DO 文の中で戻す。失敗したら DO 文ごと取り消される）
  alter table public.notifications disable trigger notifications_push_dispatch;

  insert into public.notifications
    (org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at, immediate_email_sent_at)
  select r.org_id,
         r.space_id,
         ra.reviewer_id,
         'in_app',
         'review_request',
         format('review_request:%s:%s', r.id, ra.reviewer_id),
         jsonb_build_object(
           'task_id', t.id,
           'task_title', t.title,
           'title', format('社内承認の依頼: 「%s」', t.title),
           'message', '社内承認をお願いします。承認するか、理由を添えて差し戻してください。',
           'from_user_name', p.display_name,
           'source', 'backfill_20260911'
         ),
         ra.created_at,
         now()
    from public.review_approvals ra
    join public.reviews r on r.id = ra.review_id
    join public.tasks t on t.id = r.task_id
    join public.spaces s on s.id = r.space_id
    left join public.profiles p on p.id = r.created_by
   where ra.state = 'pending'
     and r.status = 'open'
     and ra.reviewer_id is distinct from r.created_by
     -- アーカイブしたプロジェクトの依頼は出さない
     and s.archived_at is null
     -- 今も承認者になれる人だけ（rpc_review_open の確認＝space の admin / editor に加え、組織の社内メンバーであることも見る）。
     -- 07-05 より前は相手先や閲覧者も承認者に指定でき、メンバーから外しても承認者の行は残るため
     and exists (select 1 from public.space_memberships sm
                  where sm.space_id = r.space_id and sm.user_id = ra.reviewer_id and sm.role in ('admin', 'editor'))
     and exists (select 1 from public.org_memberships om
                  where om.org_id = r.org_id and om.user_id = ra.reviewer_id and om.role in ('owner', 'admin', 'member'))
  on conflict (to_user_id, channel, dedupe_key) do nothing;

  alter table public.notifications enable trigger notifications_push_dispatch;
end $$;

-- =============================================================================
-- ロールバック（手で流す。上から順に）
--   1) お知らせを片付けるトリガーを外す:
--      drop trigger if exists review_approvals_settle_notice on public.review_approvals;
--      drop trigger if exists reviews_cancel_settle_notice on public.reviews;
--      drop function if exists public.app_review_approval_settle_notice();
--      drop function if exists public.app_review_cancel_settle_notice();
--   2) お知らせの無い定義に戻す: 20260911143112_space_role_boundary.sql の
--      「-- rpc_review_open（土台: 20260705133733_rpc_review_open_internal_reviewers.sql）」の
--      create or replace をそのまま流す
--   3) 節 3 で足したお知らせを消す（依頼のときに作られたものは消さない）:
--      delete from public.notifications
--       where type = 'review_request' and payload->>'source' = 'backfill_20260911';
-- =============================================================================

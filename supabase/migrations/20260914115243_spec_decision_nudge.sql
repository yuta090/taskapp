-- 「決めてください」を受信トレイに届ける
--
-- `spec_decision_needed` は**表示する側だけ**が作ってあった。受信トレイの分類・ラベル・
-- 届け方・パネル（その場で「決定にする」が押せる）は揃っているのに、**お知らせを作る側が
-- どこにも無い**（作っていたのはテスト用のデータだけ）。決め忘れが起きても誰も気づかない。
--
-- ユーザーの希望は「会議が終わったとき」と「期限が来ても未決のとき」の両方。
-- 受信トレイのパネルは**1件ずつ**（決定ボタンが1つ）なので、まとめて1通にはできない。
-- 代わりに**同じお知らせを2つのきっかけで出し、1つの決定につき1回だけ届く**ようにする
-- （dedupe_key がタスクと人で決まるので、会議終了で届いたものは期限超過で重ねて届かない）。
--
-- rpc_meeting_end は書き換えない。あの関数は大きく、歯止めも多い。代わりに
-- 「最近終わった会議」もこの見張り役が拾う（15分ごとなので実用上すぐ届く）。

-- ---------------------------------------------------------------------------
-- 誰に届けるか
-- ---------------------------------------------------------------------------
-- そのタスクの**ボールを持っている側**の担当者（task_owners.side = tasks.ball）。
-- 相手先が決めることなら相手先に、社内で決めることなら社内の担当に届く。
-- 担当が1人もいないタスクは誰にも届かない（宛先が決められないため。作成者へは送らない
-- ＝「自分で決めろ」という催促にならないように）。

CREATE OR REPLACE FUNCTION public.process_spec_decision_nudges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_sent integer := 0;
BEGIN
  WITH target_tasks AS (
    SELECT DISTINCT
      t.id,
      t.org_id,
      t.space_id,
      t.title,
      t.ball,
      t.due_date,
      -- なぜ今知らせるのか（お知らせの文面に使う）
      CASE
        WHEN t.due_date IS NOT NULL AND t.due_date < v_today THEN 'overdue'
        ELSE 'meeting_ended'
      END AS reason
    FROM tasks t
    WHERE t.type = 'spec'
      AND t.decision_state = 'considering'
      AND t.status <> 'done'
      AND (
        -- (1) 期限を過ぎても決まっていない
        (t.due_date IS NOT NULL AND t.due_date < v_today)
        OR
        -- (2) このタスクを作った会議が、直近24時間のうちに終わった
        EXISTS (
          SELECT 1
          FROM task_events te
          JOIN meetings m ON m.id = te.meeting_id
          WHERE te.task_id = t.id
            AND te.meeting_id IS NOT NULL
            AND m.ended_at IS NOT NULL
            AND m.ended_at > now() - interval '24 hours'
        )
      )
  ),
  inserted AS (
    INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
    SELECT
      tt.org_id,
      tt.space_id,
      tow.user_id,
      'in_app',
      'spec_decision_needed',
      -- タスクと人で1回だけ。会議終了で届いたものは、期限超過では重ねて届かない
      format('spec_decision_needed:%s:%s', tt.id, tow.user_id),
      jsonb_build_object(
        'title', format('決めてください: 「%s」', tt.title),
        'message',
          CASE tt.reason
            WHEN 'overdue' THEN format('期限（%s）を過ぎましたが、まだ決まっていません。', tt.due_date)
            ELSE '会議が終わりました。この件はまだ決まっていません。'
          END,
        'task_id', tt.id,
        'reason', tt.reason
      )
    FROM target_tasks tt
    JOIN task_owners tow
      ON tow.task_id = tt.id
     AND tow.side = tt.ball
    ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_sent FROM inserted;

  RETURN v_sent;
END;
$$;

COMMENT ON FUNCTION public.process_spec_decision_nudges() IS
  '未決の決定事項のタスクについて「決めてください」を受信トレイに入れる（期限超過・会議終了の2つのきっかけ。タスクと人で1回だけ）';

-- 呼ぶのは pg_cron（登録したロールの権限で動く）だけ。外からは呼ばせない。
REVOKE ALL ON FUNCTION public.process_spec_decision_nudges() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15分ごとに動かす（20260911130910 と同じ作法。同名の job があれば作り直す）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spec-decision-nudges' AND username = current_user) THEN
      PERFORM cron.unschedule('spec-decision-nudges');
    END IF;
    PERFORM cron.schedule('spec-decision-nudges', '*/15 * * * *', 'select public.process_spec_decision_nudges()');
  END IF;
END $$;

-- 適用後の確認:
--   1. select public.process_spec_decision_nudges();  -- 何件入ったか
--   2. 期限切れの未決の決定事項のタスクを1つ作る → 15分以内に、ボールを持つ側の担当の受信トレイに出る。
--      開くと「決定にする」が押せる。
--   3. もう一度流しても増えない（タスクと人で1回だけ）。
--   4. 決定済み・完了・担当のいないタスクには出ない。
--
-- ロールバック:
--   select cron.unschedule('spec-decision-nudges');
--   drop function if exists public.process_spec_decision_nudges();

-- =============================================================================
-- Portal Dashboard Test Data
-- クライアントポータルの全表示パターンを確認するためのテストデータ
--
-- 対象ユーザー: client2@client.com (高橋 美咲)
--
-- 実行前に auth.users にユーザーが存在する必要があります：
-- Supabase Dashboard > Authentication > Users で確認/作成
-- =============================================================================

-- テスト用の固定UUID
-- クライアントユーザーのUUIDは実際のauth.usersから取得する必要があります
-- 以下は仮のUUID - 実際の値に置き換えてください

DO $$
DECLARE
  v_client_user_id uuid;
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_space_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_now timestamptz := now();
BEGIN
  -- クライアントユーザーのIDを取得
  SELECT id INTO v_client_user_id
  FROM auth.users
  WHERE email = 'client2@client.com';

  IF v_client_user_id IS NULL THEN
    RAISE EXCEPTION 'User client2@client.com not found in auth.users. Please create the user first.';
  END IF;

  RAISE NOTICE 'Found client user: %', v_client_user_id;

  -- ==========================================================================
  -- 1. 組織（既存があれば再利用）
  -- ==========================================================================
  INSERT INTO organizations (id, name, created_at)
  VALUES (v_org_id, 'ポータルテスト株式会社', v_now)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  -- ==========================================================================
  -- 2. テストプロジェクト（スペース）
  -- ==========================================================================
  INSERT INTO spaces (id, org_id, type, name, created_at)
  VALUES (v_space_id, v_org_id, 'project', 'ECサイトリニューアル', v_now)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  -- ==========================================================================
  -- 3. プロファイル（既存があれば更新）
  -- ==========================================================================
  INSERT INTO profiles (id, display_name, created_at, updated_at)
  VALUES (v_client_user_id, '高橋 美咲', v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- ==========================================================================
  -- 4. スペースメンバーシップ（クライアントとして登録）
  -- ==========================================================================
  INSERT INTO space_memberships (id, space_id, user_id, role, created_at)
  VALUES (
    gen_random_uuid(),
    v_space_id,
    v_client_user_id,
    'client',
    v_now
  )
  ON CONFLICT DO NOTHING;

  -- ==========================================================================
  -- 5. マイルストーン（様々なステータス）
  -- ==========================================================================

  -- 完了したマイルストーン
  INSERT INTO milestones (id, org_id, space_id, name, status, due_date, order_key, created_at)
  VALUES
    ('bbbbbbbb-0001-0000-0000-000000000001', v_org_id, v_space_id,
     '要件定義完了', 'done',
     (v_now - interval '30 days')::date, 1, v_now - interval '60 days')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

  -- 現在進行中のマイルストーン
  INSERT INTO milestones (id, org_id, space_id, name, status, due_date, order_key, created_at)
  VALUES
    ('bbbbbbbb-0002-0000-0000-000000000001', v_org_id, v_space_id,
     'UI/UXデザイン完了', 'in_progress',
     (v_now + interval '7 days')::date, 2, v_now - interval '30 days')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

  -- 今後のマイルストーン
  INSERT INTO milestones (id, org_id, space_id, name, status, due_date, order_key, created_at)
  VALUES
    ('bbbbbbbb-0003-0000-0000-000000000001', v_org_id, v_space_id,
     'フロントエンド実装', 'backlog',
     (v_now + interval '30 days')::date, 3, v_now - interval '30 days'),
    ('bbbbbbbb-0004-0000-0000-000000000001', v_org_id, v_space_id,
     'バックエンド実装', 'backlog',
     (v_now + interval '45 days')::date, 4, v_now - interval '30 days'),
    ('bbbbbbbb-0005-0000-0000-000000000001', v_org_id, v_space_id,
     'テスト・リリース', 'backlog',
     (v_now + interval '60 days')::date, 5, v_now - interval '30 days')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

  -- ==========================================================================
  -- 6. タスク - 様々なステータスパターン
  -- ==========================================================================

  -- ------------------------------------------------------------
  -- パターン1: 期限切れ（ball=client, overdue） → needs_attention
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at)
  VALUES
    ('cccccccc-0001-0000-0000-000000000001', v_org_id, v_space_id,
     '【緊急】商品一覧ページのデザイン確認', 'considering', 'client', 'internal', 'task',
     (v_now - interval '5 days')::date, v_now - interval '7 days'),
    ('cccccccc-0002-0000-0000-000000000001', v_org_id, v_space_id,
     '決済フローの仕様確認', 'considering', 'client', 'internal', 'spec',
     (v_now - interval '3 days')::date, v_now - interval '10 days')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  -- スペックタスクには spec_path と decision_state が必要
  UPDATE tasks SET
    spec_path = '/spec/payment-flow#checkout',
    decision_state = 'considering'
  WHERE id = 'cccccccc-0002-0000-0000-000000000001';

  -- ------------------------------------------------------------
  -- パターン2: 本日期限（ball=client）
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at)
  VALUES
    ('cccccccc-0003-0000-0000-000000000001', v_org_id, v_space_id,
     'トップページバナー画像の選定', 'considering', 'client', 'internal', 'task',
     v_now::date, v_now - interval '2 days')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  -- ------------------------------------------------------------
  -- パターン3: 近い期限（ball=client, 3日後）
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at)
  VALUES
    ('cccccccc-0004-0000-0000-000000000001', v_org_id, v_space_id,
     'お問い合わせフォームの項目確認', 'considering', 'client', 'internal', 'task',
     (v_now + interval '3 days')::date, v_now - interval '1 day')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  -- ------------------------------------------------------------
  -- パターン4: 長期待機（ball=client, 5日以上経過）→ at_risk
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at)
  VALUES
    ('cccccccc-0005-0000-0000-000000000001', v_org_id, v_space_id,
     'マイページ機能の仕様承認', 'considering', 'client', 'internal', 'spec',
     (v_now + interval '7 days')::date, v_now - interval '6 days')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  UPDATE tasks SET
    spec_path = '/spec/mypage#feature-list',
    decision_state = 'considering'
  WHERE id = 'cccccccc-0005-0000-0000-000000000001';

  -- ------------------------------------------------------------
  -- パターン5: 期限なし（ball=client）
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at)
  VALUES
    ('cccccccc-0006-0000-0000-000000000001', v_org_id, v_space_id,
     'ロゴの色味調整案の確認', 'considering', 'client', 'internal', 'task',
     NULL, v_now - interval '2 days')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  -- ------------------------------------------------------------
  -- パターン6: チーム作業中（ball=internal）→ 進捗表示用
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at)
  VALUES
    ('cccccccc-0007-0000-0000-000000000001', v_org_id, v_space_id,
     '商品詳細ページのコーディング', 'in_progress', 'internal', 'internal', 'task',
     (v_now + interval '5 days')::date, v_now - interval '3 days'),
    ('cccccccc-0008-0000-0000-000000000001', v_org_id, v_space_id,
     'カート機能の実装', 'in_progress', 'internal', 'internal', 'task',
     (v_now + interval '10 days')::date, v_now - interval '5 days'),
    ('cccccccc-0009-0000-0000-000000000001', v_org_id, v_space_id,
     'データベース設計', 'in_progress', 'internal', 'internal', 'task',
     (v_now + interval '3 days')::date, v_now - interval '7 days'),
    ('cccccccc-0010-0000-0000-000000000001', v_org_id, v_space_id,
     'API設計書作成', 'todo', 'internal', 'internal', 'task',
     (v_now + interval '14 days')::date, v_now - interval '1 day')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  -- ------------------------------------------------------------
  -- パターン7: 完了済み（進捗表示用）
  -- ------------------------------------------------------------
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_at, updated_at)
  VALUES
    ('cccccccc-0011-0000-0000-000000000001', v_org_id, v_space_id,
     'ワイヤーフレーム作成', 'done', 'internal', 'internal', 'task',
     (v_now - interval '20 days')::date, v_now - interval '30 days', v_now - interval '18 days'),
    ('cccccccc-0012-0000-0000-000000000001', v_org_id, v_space_id,
     '要件定義書レビュー', 'done', 'internal', 'client', 'task',
     (v_now - interval '25 days')::date, v_now - interval '35 days', v_now - interval '23 days'),
    ('cccccccc-0013-0000-0000-000000000001', v_org_id, v_space_id,
     'カラーパレット決定', 'done', 'internal', 'internal', 'task',
     (v_now - interval '15 days')::date, v_now - interval '20 days', v_now - interval '14 days'),
    ('cccccccc-0014-0000-0000-000000000001', v_org_id, v_space_id,
     'フォント選定', 'done', 'internal', 'internal', 'task',
     (v_now - interval '12 days')::date, v_now - interval '18 days', v_now - interval '11 days'),
    ('cccccccc-0015-0000-0000-000000000001', v_org_id, v_space_id,
     'モックアップ作成', 'done', 'internal', 'internal', 'task',
     (v_now - interval '8 days')::date, v_now - interval '15 days', v_now - interval '7 days')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  -- ==========================================================================
  -- 7. 監査ログ（アクティビティフィード用）
  -- ==========================================================================

  -- 既存のaudit_logsを削除（テスト用）
  DELETE FROM audit_logs WHERE space_id = v_space_id;

  INSERT INTO audit_logs (id, space_id, task_id, actor_id, action, payload, created_at)
  VALUES
    -- 最近のアクティビティ
    (gen_random_uuid(), v_space_id, 'cccccccc-0015-0000-0000-000000000001', v_client_user_id,
     'task_approved', '{"comment": "デザイン問題ありません"}', v_now - interval '7 days'),
    (gen_random_uuid(), v_space_id, 'cccccccc-0014-0000-0000-000000000001', v_client_user_id,
     'task_approved', '{"comment": null}', v_now - interval '11 days'),
    (gen_random_uuid(), v_space_id, 'cccccccc-0013-0000-0000-000000000001', v_client_user_id,
     'task_approved', '{"comment": "このカラーで進めてください"}', v_now - interval '14 days'),
    (gen_random_uuid(), v_space_id, 'cccccccc-0012-0000-0000-000000000001', v_client_user_id,
     'task_approved', '{"comment": "内容確認しました。OKです"}', v_now - interval '23 days'),
    -- 修正依頼の例
    (gen_random_uuid(), v_space_id, 'cccccccc-0011-0000-0000-000000000001', v_client_user_id,
     'changes_requested', '{"comment": "ナビゲーションの位置を再検討してください"}', v_now - interval '20 days');

  RAISE NOTICE 'Test data created successfully for space: %', v_space_id;
END $$;

-- ==========================================================================
-- 確認クエリ
-- ==========================================================================

-- 作成されたタスクを確認
SELECT
  t.title,
  t.status,
  t.ball,
  t.type,
  t.due_date,
  CASE
    WHEN t.due_date < CURRENT_DATE THEN 'OVERDUE'
    WHEN t.due_date = CURRENT_DATE THEN 'TODAY'
    ELSE 'UPCOMING'
  END as due_status,
  EXTRACT(DAY FROM now() - t.created_at)::int as waiting_days
FROM tasks t
JOIN spaces s ON t.space_id = s.id
WHERE s.name = 'ECサイトリニューアル'
ORDER BY t.ball DESC, t.due_date ASC NULLS LAST;

-- マイルストーンを確認
SELECT name, status, due_date
FROM milestones
WHERE space_id = 'aaaaaaaa-0000-0000-0000-000000000001'
ORDER BY order_key;

-- 統計情報
SELECT
  COUNT(*) FILTER (WHERE ball = 'client') as client_ball_count,
  COUNT(*) FILTER (WHERE ball = 'internal') as internal_ball_count,
  COUNT(*) FILTER (WHERE status = 'done') as done_count,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE ball = 'client' AND due_date < CURRENT_DATE) as overdue_count
FROM tasks
WHERE space_id = 'aaaaaaaa-0000-0000-0000-000000000001';

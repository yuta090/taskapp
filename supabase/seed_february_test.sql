-- =============================================================================
-- February 2026 Test Data
-- 2026年2月2日を基準としたポータルダッシュボードのテストデータ
--
-- 期限切れタスク: 2件
-- 2月中に期限のタスク: 10件
-- =============================================================================

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_space_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_created_by uuid := '49491853-c5f3-4395-9538-271a509da3a7'; -- demo@example.com
  v_client_user_id uuid;
  v_now timestamptz := now();
BEGIN

  -- クライアントユーザーのIDを取得
  SELECT id INTO v_client_user_id
  FROM auth.users
  WHERE email = 'client2@client.com';

  IF v_client_user_id IS NULL THEN
    RAISE EXCEPTION 'User client2@client.com not found in auth.users.';
  END IF;

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
  -- 3. プロファイル
  -- ==========================================================================
  INSERT INTO profiles (id, display_name, created_at, updated_at)
  VALUES (v_client_user_id, '高橋 美咲', v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- ==========================================================================
  -- 4. スペースメンバーシップ
  -- ==========================================================================
  INSERT INTO space_memberships (id, space_id, user_id, role, created_at)
  VALUES (gen_random_uuid(), v_space_id, v_client_user_id, 'client', v_now)
  ON CONFLICT DO NOTHING;

  -- ==========================================================================
  -- 5. マイルストーン
  -- ==========================================================================
  INSERT INTO milestones (id, org_id, space_id, name, due_date, order_key, created_at)
  VALUES
    ('bbbbbbbb-0001-0000-0000-000000000001', v_org_id, v_space_id,
     '要件定義完了', '2026-01-15', 1, v_now - interval '60 days'),
    ('bbbbbbbb-0002-0000-0000-000000000001', v_org_id, v_space_id,
     'UI/UXデザイン完了', '2026-02-15', 2, v_now - interval '30 days'),
    ('bbbbbbbb-0003-0000-0000-000000000001', v_org_id, v_space_id,
     'フロントエンド実装', '2026-03-01', 3, v_now - interval '30 days')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, due_date = EXCLUDED.due_date;

  -- ==========================================================================
  -- 既存タスクを削除（cccccccc-002x/003x系のみ）
  -- ==========================================================================
  DELETE FROM tasks WHERE id::text LIKE 'cccccccc-002%' OR id::text LIKE 'cccccccc-003%';

  -- ==========================================================================
  -- 期限切れタスク（2件）- ball=client で表示される
  -- ==========================================================================

  -- 期限切れ1: 3日遅れ（1月30日）
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0021-0000-0000-000000000001', v_org_id, v_space_id,
     'ヘッダーデザインの最終確認', 'considering', 'client', 'internal', 'task',
     '2026-01-30', v_created_by, '2026-01-20 10:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 期限切れ2: 2日遅れ（1月31日）
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0022-0000-0000-000000000001', v_org_id, v_space_id,
     '利用規約ページの文言チェック', 'considering', 'client', 'internal', 'task',
     '2026-01-31', v_created_by, '2026-01-22 14:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- ==========================================================================
  -- 2月中に期限のタスク（10件）
  -- ==========================================================================

  -- 2月5日（3日後）
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0023-0000-0000-000000000001', v_org_id, v_space_id,
     '商品カテゴリの階層構造レビュー', 'considering', 'client', 'internal', 'task',
     '2026-02-05', v_created_by, '2026-01-28 09:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月7日（5日後）
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0024-0000-0000-000000000001', v_org_id, v_space_id,
     '会員登録フォームの項目確認', 'considering', 'client', 'internal', 'task',
     '2026-02-07', v_created_by, '2026-01-30 11:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月10日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at, spec_path, decision_state)
  VALUES
    ('cccccccc-0025-0000-0000-000000000001', v_org_id, v_space_id,
     'お気に入り機能の仕様承認', 'considering', 'client', 'internal', 'spec',
     '2026-02-10', v_created_by, '2026-02-01 10:00:00+09', '/spec/favorite#basic', 'considering')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date,
    spec_path = EXCLUDED.spec_path, decision_state = EXCLUDED.decision_state;

  -- 2月12日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0026-0000-0000-000000000001', v_org_id, v_space_id,
     'パスワードリセット画面の確認', 'considering', 'client', 'internal', 'task',
     '2026-02-12', v_created_by, '2026-02-01 14:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月14日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0027-0000-0000-000000000001', v_org_id, v_space_id,
     'ニュースレター購読フォームの文言確認', 'considering', 'client', 'internal', 'task',
     '2026-02-14', v_created_by, '2026-02-02 09:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月17日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0028-0000-0000-000000000001', v_org_id, v_space_id,
     '配送オプション一覧の内容確認', 'considering', 'client', 'internal', 'task',
     '2026-02-17', v_created_by, '2026-02-03 10:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月19日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at, spec_path, decision_state)
  VALUES
    ('cccccccc-0029-0000-0000-000000000001', v_org_id, v_space_id,
     'クーポン適用ロジックの仕様確認', 'considering', 'client', 'internal', 'spec',
     '2026-02-19', v_created_by, '2026-02-05 11:00:00+09', '/spec/coupon#apply-logic', 'considering')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date,
    spec_path = EXCLUDED.spec_path, decision_state = EXCLUDED.decision_state;

  -- 2月21日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0030-0000-0000-000000000001', v_org_id, v_space_id,
     'エラーメッセージの日本語表現レビュー', 'considering', 'client', 'internal', 'task',
     '2026-02-21', v_created_by, '2026-02-10 09:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月24日
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0031-0000-0000-000000000001', v_org_id, v_space_id,
     '注文確認メールのテンプレート確認', 'considering', 'client', 'internal', 'task',
     '2026-02-24', v_created_by, '2026-02-12 14:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- 2月28日（月末）
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at)
  VALUES
    ('cccccccc-0032-0000-0000-000000000001', v_org_id, v_space_id,
     'プライバシーポリシーの最終確認', 'considering', 'client', 'internal', 'task',
     '2026-02-28', v_created_by, '2026-02-15 10:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball, due_date = EXCLUDED.due_date;

  -- ==========================================================================
  -- 完了済みタスク（進捗表示用）
  -- ==========================================================================
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, created_by, created_at, updated_at)
  VALUES
    ('cccccccc-0033-0000-0000-000000000001', v_org_id, v_space_id,
     'ワイヤーフレーム作成', 'done', 'internal', 'internal', 'task',
     '2026-01-10', v_created_by, '2025-12-20 10:00:00+09', '2026-01-08 15:00:00+09'),
    ('cccccccc-0034-0000-0000-000000000001', v_org_id, v_space_id,
     '要件定義書レビュー', 'done', 'internal', 'client', 'task',
     '2026-01-15', v_created_by, '2026-01-01 10:00:00+09', '2026-01-13 14:00:00+09'),
    ('cccccccc-0035-0000-0000-000000000001', v_org_id, v_space_id,
     'カラーパレット決定', 'done', 'internal', 'internal', 'task',
     '2026-01-18', v_created_by, '2026-01-05 10:00:00+09', '2026-01-17 11:00:00+09')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, ball = EXCLUDED.ball;

  RAISE NOTICE 'February 2026 test data created: 2 overdue + 10 upcoming + 3 done tasks';
END $$;

-- ==========================================================================
-- 確認クエリ
-- ==========================================================================

SELECT
  title,
  due_date,
  CASE
    WHEN due_date < '2026-02-02' THEN '🔴 期限切れ'
    WHEN due_date = '2026-02-02' THEN '📅 今日'
    ELSE '📆 ' || to_char(due_date, 'MM/DD')
  END as status_label,
  type,
  status
FROM tasks
WHERE id::text LIKE 'cccccccc-002%' OR id::text LIKE 'cccccccc-003%'
ORDER BY due_date;

-- 統計
SELECT
  COUNT(*) FILTER (WHERE ball = 'client' AND status != 'done') as client_pending,
  COUNT(*) FILTER (WHERE status = 'done') as completed,
  COUNT(*) as total
FROM tasks
WHERE id::text LIKE 'cccccccc-002%' OR id::text LIKE 'cccccccc-003%';

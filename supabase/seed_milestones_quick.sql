-- ========================================
-- マイルストーンテストデータ（実行可能版）
-- Supabase SQL Editorで実行してください
-- ========================================

-- Step 1: まずスペースのorg_idを確認
SELECT id, org_id, name FROM spaces WHERE id = '00000000-0000-0000-0000-000000000010';

-- Step 2: statusカラムがない場合は追加（エラーになる場合はスキップ）
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS status text DEFAULT 'backlog';

-- Step 3: マイルストーン挿入
-- org_idは上記Step 1で確認した値を使用（通常は '00000000-0000-0000-0000-000000000001'）
INSERT INTO milestones (id, org_id, space_id, name, status, due_date, order_key)
VALUES
  -- 完了したマイルストーン
  ('11111111-1111-1111-1111-000000000001',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   '要件定義完了', 'done',
   (CURRENT_DATE - INTERVAL '30 days')::date, 1),

  -- 現在進行中（ダッシュボードのCURRENT PHASEに表示）
  ('11111111-1111-1111-1111-000000000002',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   'デザインフェーズ', 'in_progress',
   (CURRENT_DATE + INTERVAL '7 days')::date, 2),

  -- 今後のマイルストーン
  ('11111111-1111-1111-1111-000000000003',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   '開発フェーズ', 'backlog',
   (CURRENT_DATE + INTERVAL '30 days')::date, 3),

  ('11111111-1111-1111-1111-000000000004',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   'テスト・リリース', 'backlog',
   (CURRENT_DATE + INTERVAL '60 days')::date, 4)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  due_date = EXCLUDED.due_date,
  order_key = EXCLUDED.order_key;

-- Step 4: 確認
SELECT id, name, status, due_date, order_key
FROM milestones
WHERE space_id = '00000000-0000-0000-0000-000000000010'
ORDER BY order_key;

-- =============================================================================
-- Agency Mode Test Data
-- エージェンシーモード (3者間ワークフロー) のテストデータ
--
-- 登場人物:
--   - demo@example.com (田中 太郎) → Agency PM (admin)
--   - staff1@example.com (佐藤 花子) → Agency デザイナー (editor)
--   - client1@client.com (鈴木 一郎) → クライアント PM
--   - vendor1@vendor.com (中村 健太) → ベンダー ディレクター (NEW)
--   - vendor2@vendor.com (松本 理恵) → ベンダー デザイナー (NEW)
--
-- 実行前:
--   1. vendor1/vendor2 の auth.users を作成済みであること
--   2. 既存のデモ組織 (00000000-0000-0000-0000-000000000001) が存在すること
-- =============================================================================

DO $$
DECLARE
  v_vendor1_id uuid;
  v_vendor2_id uuid;
  v_demo_id uuid;
  v_staff1_id uuid;
  v_client1_id uuid;
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_space_id uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_now timestamptz := now();
BEGIN
  -- ユーザーID取得
  SELECT id INTO v_demo_id FROM auth.users WHERE email = 'demo@example.com';
  SELECT id INTO v_staff1_id FROM auth.users WHERE email = 'staff1@example.com';
  SELECT id INTO v_client1_id FROM auth.users WHERE email = 'client1@client.com';
  SELECT id INTO v_vendor1_id FROM auth.users WHERE email = 'vendor1@vendor.com';
  SELECT id INTO v_vendor2_id FROM auth.users WHERE email = 'vendor2@vendor.com';

  IF v_demo_id IS NULL THEN RAISE EXCEPTION 'User demo@example.com not found'; END IF;
  IF v_client1_id IS NULL THEN RAISE EXCEPTION 'User client1@client.com not found'; END IF;
  IF v_vendor1_id IS NULL THEN RAISE EXCEPTION 'User vendor1@vendor.com not found. Create with: seed_agency_users first'; END IF;
  IF v_vendor2_id IS NULL THEN RAISE EXCEPTION 'User vendor2@vendor.com not found. Create with: seed_agency_users first'; END IF;

  RAISE NOTICE 'Found users: demo=%, staff1=%, client1=%, vendor1=%, vendor2=%',
    v_demo_id, v_staff1_id, v_client1_id, v_vendor1_id, v_vendor2_id;

  -- ==========================================================================
  -- 1. プロファイル (ベンダーユーザー)
  -- ==========================================================================
  INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES
    (v_vendor1_id, '中村 健太', v_now, v_now),
    (v_vendor2_id, '松本 理恵', v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- ==========================================================================
  -- 2. Agency Mode スペース
  --    代理店モードの space を作る・切り替えるのはサーバー（service_role）だけ（spaces の見張り
  --    guard_agency_settings）。この insert の間だけ service_role で行う
  -- ==========================================================================
  SET LOCAL ROLE service_role;
  INSERT INTO spaces (id, org_id, type, name, agency_mode, created_at)
  VALUES (
    v_space_id, v_org_id, 'project',
    'CM動画制作プロジェクト',
    true,           -- agency_mode ON
    v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    agency_mode = EXCLUDED.agency_mode;
  RESET ROLE;

  -- 既定の利益率・ベンダーポータル設定は社内専用の別表 space_agency_settings へ
  INSERT INTO space_agency_settings (space_id, org_id, default_margin_rate, vendor_settings)
  VALUES (
    v_space_id, v_org_id,
    35.00,          -- default margin 35%
    '{"show_client_name": false, "allow_client_comments": false}'
  )
  ON CONFLICT (space_id) DO UPDATE SET
    default_margin_rate = EXCLUDED.default_margin_rate,
    vendor_settings = EXCLUDED.vendor_settings;

  -- ==========================================================================
  -- 3. Org メンバーシップ (ベンダーは client ロールで org に参加)
  -- ==========================================================================
  INSERT INTO org_memberships (org_id, user_id, role) VALUES
    (v_org_id, v_vendor1_id, 'client'),
    (v_org_id, v_vendor2_id, 'client')
  ON CONFLICT DO NOTHING;

  -- ==========================================================================
  -- 4. Space メンバーシップ
  -- ==========================================================================
  -- 既存メンバーシップ削除して再作成
  DELETE FROM space_memberships WHERE space_id = v_space_id;

  INSERT INTO space_memberships (id, space_id, user_id, role, created_at) VALUES
    (gen_random_uuid(), v_space_id, v_demo_id,    'admin',   v_now),
    (gen_random_uuid(), v_space_id, v_staff1_id,  'editor',  v_now),
    (gen_random_uuid(), v_space_id, v_client1_id, 'client',  v_now),
    (gen_random_uuid(), v_space_id, v_vendor1_id, 'vendor',  v_now),
    (gen_random_uuid(), v_space_id, v_vendor2_id, 'vendor',  v_now);

  -- ==========================================================================
  -- 5. マイルストーン
  -- ==========================================================================
  DELETE FROM milestones WHERE space_id = v_space_id;

  -- 完了かどうかは completed_at（配下のタスクがすべて完了すると、tasks のトリガーが入れる）
  INSERT INTO milestones (id, org_id, space_id, name, due_date, order_key, created_at) VALUES
    ('eeeeeeee-0001-0000-0000-000000000001', v_org_id, v_space_id,
     'プリプロダクション',
     (v_now - interval '14 days')::date, 1, v_now - interval '30 days'),
    ('eeeeeeee-0002-0000-0000-000000000001', v_org_id, v_space_id,
     '撮影・制作',
     (v_now + interval '14 days')::date, 2, v_now - interval '20 days'),
    ('eeeeeeee-0003-0000-0000-000000000001', v_org_id, v_space_id,
     'ポストプロダクション',
     (v_now + interval '30 days')::date, 3, v_now - interval '20 days'),
    ('eeeeeeee-0004-0000-0000-000000000001', v_org_id, v_space_id,
     '納品・検収',
     (v_now + interval '45 days')::date, 4, v_now - interval '20 days');

  -- ==========================================================================
  -- 6. タスク (3者間の ball パターン)
  -- ==========================================================================
  DELETE FROM tasks WHERE space_id = v_space_id;

  -- 作った人（created_by）はどれもデモの Agency PM
  -- ベンダーボール (vendor が対応すべき)
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, assignee_id, milestone_id, created_by, created_at) VALUES
    ('ffffffff-0001-0000-0000-000000000001', v_org_id, v_space_id,
     'ロケハン候補地リスト作成', 'in_progress', 'vendor', 'internal', 'task',
     (v_now + interval '3 days')::date, v_vendor1_id,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '2 days'),
    ('ffffffff-0002-0000-0000-000000000001', v_org_id, v_space_id,
     'キャスティング候補者リスト', 'todo', 'vendor', 'internal', 'task',
     (v_now + interval '5 days')::date, v_vendor2_id,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '1 day'),
    ('ffffffff-0003-0000-0000-000000000001', v_org_id, v_space_id,
     '撮影スケジュール案の作成', 'todo', 'vendor', 'internal', 'task',
     (v_now + interval '7 days')::date, v_vendor1_id,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '1 day');

  -- エージェンシーボール (agency が対応すべき)
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, assignee_id, milestone_id, created_by, created_at) VALUES
    ('ffffffff-0004-0000-0000-000000000001', v_org_id, v_space_id,
     'クライアント向けコンテ修正', 'in_progress', 'agency', 'internal', 'task',
     (v_now + interval '2 days')::date, v_staff1_id,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '3 days'),
    ('ffffffff-0005-0000-0000-000000000001', v_org_id, v_space_id,
     'ベンダー見積もり確認・承認', 'todo', 'agency', 'internal', 'task',
     (v_now + interval '4 days')::date, v_demo_id,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '2 days');

  -- クライアントボール (client が確認すべき。ボールが client のタスクは client_scope = deliverable)
  -- spec タスクは、作るときに spec_path と decision_state が要る
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, client_scope, spec_path, decision_state, due_date, milestone_id, created_by, created_at) VALUES
    ('ffffffff-0006-0000-0000-000000000001', v_org_id, v_space_id,
     '絵コンテ最終承認', 'considering', 'client', 'internal', 'task', 'deliverable', NULL, NULL,
     (v_now + interval '1 day')::date,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '5 days'),
    ('ffffffff-0007-0000-0000-000000000001', v_org_id, v_space_id,
     'ナレーション原稿承認', 'considering', 'client', 'internal', 'spec', 'deliverable', '/spec/narration#script', 'considering',
     (v_now - interval '2 days')::date,
     'eeeeeeee-0002-0000-0000-000000000001', v_demo_id, v_now - interval '7 days');

  -- internal ボール
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, assignee_id, milestone_id, created_by, created_at) VALUES
    ('ffffffff-0008-0000-0000-000000000001', v_org_id, v_space_id,
     '楽曲ライセンス契約手配', 'in_progress', 'internal', 'internal', 'task',
     (v_now + interval '10 days')::date, v_demo_id,
     'eeeeeeee-0003-0000-0000-000000000001', v_demo_id, v_now - interval '3 days');

  -- 完了タスク
  INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, due_date, milestone_id, created_by, created_at, updated_at) VALUES
    ('ffffffff-0009-0000-0000-000000000001', v_org_id, v_space_id,
     'プロジェクトキックオフ', 'done', 'internal', 'internal', 'task',
     (v_now - interval '20 days')::date,
     'eeeeeeee-0001-0000-0000-000000000001', v_demo_id, v_now - interval '25 days', v_now - interval '20 days'),
    ('ffffffff-0010-0000-0000-000000000001', v_org_id, v_space_id,
     '企画書・コンセプト作成', 'done', 'internal', 'internal', 'task',
     (v_now - interval '15 days')::date,
     'eeeeeeee-0001-0000-0000-000000000001', v_demo_id, v_now - interval '22 days', v_now - interval '14 days'),
    ('ffffffff-0011-0000-0000-000000000001', v_org_id, v_space_id,
     '予算概算提出', 'done', 'internal', 'client', 'task',
     (v_now - interval '10 days')::date,
     'eeeeeeee-0001-0000-0000-000000000001', v_demo_id, v_now - interval '18 days', v_now - interval '9 days');

  -- ==========================================================================
  -- 7. Task Pricing (見積もりデータ)
  --    見積の行を書けるのはサーバー（service_role）と、その space の admin / editor / vendor だけ
  --    （task_pricing の見張り）。この節の間だけ service_role で行う
  -- ==========================================================================
  SET LOCAL ROLE service_role;
  DELETE FROM task_pricing WHERE task_id IN (
    'ffffffff-0001-0000-0000-000000000001',
    'ffffffff-0002-0000-0000-000000000001',
    'ffffffff-0003-0000-0000-000000000001',
    'ffffffff-0004-0000-0000-000000000001',
    'ffffffff-0011-0000-0000-000000000001'
  );

  -- 見積もり提出済み (vendor → agency 承認待ち)
  INSERT INTO task_pricing (id, org_id, space_id, task_id, cost_hours, cost_unit_price, sell_mode, margin_rate, sell_total, vendor_submitted_at) VALUES
    (gen_random_uuid(), v_org_id, v_space_id,
     'ffffffff-0001-0000-0000-000000000001',
     40, 5000,    -- 40h x 5000 = 200,000
     'margin', 35, 270000,  -- 35% margin → 270,000
     v_now - interval '1 day');

  -- 見積もり未提出
  INSERT INTO task_pricing (id, org_id, space_id, task_id, cost_hours, cost_unit_price, sell_mode, margin_rate) VALUES
    (gen_random_uuid(), v_org_id, v_space_id,
     'ffffffff-0002-0000-0000-000000000001',
     24, 4500,    -- 24h x 4500 = 108,000
     'margin', 35);

  -- Agency承認済み → クライアント承認待ち
  INSERT INTO task_pricing (id, org_id, space_id, task_id, cost_hours, cost_unit_price, sell_mode, margin_rate, sell_total, vendor_submitted_at, agency_approved_at) VALUES
    (gen_random_uuid(), v_org_id, v_space_id,
     'ffffffff-0004-0000-0000-000000000001',
     60, 5500,    -- 60h x 5500 = 330,000
     'margin', 30, 429000,  -- 30% margin → 429,000
     v_now - interval '5 days', v_now - interval '3 days');

  -- 固定売値パターン (全承認済み)
  INSERT INTO task_pricing (id, org_id, space_id, task_id, cost_hours, cost_unit_price, sell_mode, sell_total, vendor_submitted_at, agency_approved_at, client_approved_at) VALUES
    (gen_random_uuid(), v_org_id, v_space_id,
     'ffffffff-0011-0000-0000-000000000001',
     30, 5000,    -- 30h x 5000 = 150,000
     'fixed', 250000,  -- 固定売値 250,000
     v_now - interval '15 days', v_now - interval '13 days', v_now - interval '10 days');
  RESET ROLE;

  -- ==========================================================================
  -- 8. アクティビティログ
  -- ==========================================================================
  DELETE FROM audit_logs WHERE space_id = v_space_id;

  INSERT INTO audit_logs (org_id, space_id, actor_id, actor_role, event_type, target_type, target_id,
                          data_before, data_after, occurred_at) VALUES
    (v_org_id, v_space_id, v_demo_id, 'owner', 'task.status_changed', 'task', 'ffffffff-0009-0000-0000-000000000001',
     '{"status": "in_progress"}', '{"status": "done"}', v_now - interval '20 days'),
    (v_org_id, v_space_id, v_vendor1_id, 'client', 'task.status_changed', 'task', 'ffffffff-0001-0000-0000-000000000001',
     '{"status": "todo"}', '{"status": "in_progress"}', v_now - interval '2 days'),
    (v_org_id, v_space_id, v_demo_id, 'owner', 'task.updated', 'task', 'ffffffff-0006-0000-0000-000000000001',
     '{"ball": "agency"}', '{"ball": "client"}', v_now - interval '5 days');

  RAISE NOTICE 'Agency test data created successfully for space: %', v_space_id;
END $$;

-- ==========================================================================
-- 確認クエリ
-- ==========================================================================
SELECT t.title, t.status, t.ball, t.due_date,
       p.cost_hours, p.cost_unit_price, p.cost_total, p.sell_total,
       p.vendor_submitted_at IS NOT NULL as vendor_submitted,
       p.agency_approved_at IS NOT NULL as agency_approved,
       p.client_approved_at IS NOT NULL as client_approved
FROM tasks t
LEFT JOIN task_pricing p ON p.task_id = t.id
WHERE t.space_id = 'dddddddd-0000-0000-0000-000000000001'
ORDER BY t.ball, t.status, t.created_at;

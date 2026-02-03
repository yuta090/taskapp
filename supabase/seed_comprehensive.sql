-- Comprehensive Test Data for TaskApp
-- This creates a realistic test environment with multiple users, tasks, notifications, etc.
--
-- Prerequisites:
-- 1. Run DDL migrations first
-- 2. Create test users via Supabase Auth API (see comments below)

-- =============================================================================
-- Test User IDs (create these via Supabase Auth API)
-- =============================================================================
-- Run these curl commands to create test users:
--
-- Demo User (Internal Staff - PM):
-- curl -s 'http://127.0.0.1:54321/auth/v1/admin/users' \
--   -H 'apikey: YOUR_SERVICE_ROLE_KEY' \
--   -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
--   -H 'Content-Type: application/json' \
--   -d '{"email":"demo@example.com","password":"demo1234","email_confirm":true,"user_metadata":{"name":"田中 太郎"}}'
--
-- Staff 1 (Designer):
-- curl -s 'http://127.0.0.1:54321/auth/v1/admin/users' \
--   -H 'apikey: YOUR_SERVICE_ROLE_KEY' \
--   -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
--   -H 'Content-Type: application/json' \
--   -d '{"email":"staff1@example.com","password":"staff1234","email_confirm":true,"user_metadata":{"name":"佐藤 花子"}}'
--
-- Staff 2 (Developer):
-- curl -s 'http://127.0.0.1:54321/auth/v1/admin/users' \
--   -H 'apikey: YOUR_SERVICE_ROLE_KEY' \
--   -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
--   -H 'Content-Type: application/json' \
--   -d '{"email":"staff2@example.com","password":"staff2345","email_confirm":true,"user_metadata":{"name":"山田 次郎"}}'
--
-- Client 1 (Client PM):
-- curl -s 'http://127.0.0.1:54321/auth/v1/admin/users' \
--   -H 'apikey: YOUR_SERVICE_ROLE_KEY' \
--   -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
--   -H 'Content-Type: application/json' \
--   -d '{"email":"client1@client.com","password":"client1234","email_confirm":true,"user_metadata":{"name":"鈴木 一郎"}}'
--
-- Client 2 (Client Approver):
-- curl -s 'http://127.0.0.1:54321/auth/v1/admin/users' \
--   -H 'apikey: YOUR_SERVICE_ROLE_KEY' \
--   -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
--   -H 'Content-Type: application/json' \
--   -d '{"email":"client2@client.com","password":"client2345","email_confirm":true,"user_metadata":{"name":"高橋 美咲"}}'

-- Fixed UUIDs for test users (use these after creating via Auth API)
-- Replace these with actual UUIDs from your auth.users table
DO $$
DECLARE
  demo_user_id uuid := '11111111-1111-1111-1111-111111111111';
  staff1_id uuid := '22222222-2222-2222-2222-222222222222';
  staff2_id uuid := '33333333-3333-3333-3333-333333333333';
  client1_id uuid := '44444444-4444-4444-4444-444444444444';
  client2_id uuid := '55555555-5555-5555-5555-555555555555';

  org_id uuid := '00000000-0000-0000-0000-000000000001';
  space_id uuid := '00000000-0000-0000-0000-000000000010';

  milestone1_id uuid := '00000000-0000-0000-0000-000000000100';
  milestone2_id uuid := '00000000-0000-0000-0000-000000000101';
  milestone3_id uuid := '00000000-0000-0000-0000-000000000102';

  -- Task IDs
  task_design_id uuid := 'aaaaaaaa-0001-0000-0000-000000000001';
  task_wireframe_id uuid := 'aaaaaaaa-0002-0000-0000-000000000002';
  task_logo_id uuid := 'aaaaaaaa-0003-0000-0000-000000000003';
  task_api_id uuid := 'aaaaaaaa-0004-0000-0000-000000000004';
  task_mobile_id uuid := 'aaaaaaaa-0005-0000-0000-000000000005';
  task_seo_id uuid := 'aaaaaaaa-0006-0000-0000-000000000006';
  task_hosting_id uuid := 'aaaaaaaa-0007-0000-0000-000000000007';
  task_domain_id uuid := 'aaaaaaaa-0008-0000-0000-000000000008';
  task_content_id uuid := 'aaaaaaaa-0009-0000-0000-000000000009';
  task_analytics_id uuid := 'aaaaaaaa-0010-0000-0000-000000000010';
  task_spec_nav_id uuid := 'aaaaaaaa-0011-0000-0000-000000000011';
  task_spec_payment_id uuid := 'aaaaaaaa-0012-0000-0000-000000000012';

  -- Meeting IDs
  meeting1_id uuid := 'bbbbbbbb-0001-0000-0000-000000000001';
  meeting2_id uuid := 'bbbbbbbb-0002-0000-0000-000000000002';
  meeting3_id uuid := 'bbbbbbbb-0003-0000-0000-000000000003';

  -- Review IDs
  review1_id uuid := 'cccccccc-0001-0000-0000-000000000001';
  review2_id uuid := 'cccccccc-0002-0000-0000-000000000002';
BEGIN

-- =============================================================================
-- 1) Create test users in auth.users (for local dev - skip if using real auth)
-- =============================================================================
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES
  (demo_user_id, 'demo@example.com', crypt('demo1234', gen_salt('bf')), now(), '{"name": "田中 太郎"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (staff1_id, 'staff1@example.com', crypt('staff1234', gen_salt('bf')), now(), '{"name": "佐藤 花子"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (staff2_id, 'staff2@example.com', crypt('staff2345', gen_salt('bf')), now(), '{"name": "山田 次郎"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (client1_id, 'client1@client.com', crypt('client1234', gen_salt('bf')), now(), '{"name": "鈴木 一郎"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (client2_id, 'client2@client.com', crypt('client2345', gen_salt('bf')), now(), '{"name": "高橋 美咲"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2) Organization & Space (from original seed)
-- =============================================================================
INSERT INTO organizations (id, name) VALUES
  (org_id, 'デモ組織')
ON CONFLICT DO NOTHING;

INSERT INTO spaces (id, org_id, type, name) VALUES
  (space_id, org_id, 'project', 'Webリニューアル')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 3) Org Memberships
-- =============================================================================
INSERT INTO org_memberships (org_id, user_id, role) VALUES
  (org_id, demo_user_id, 'owner'),
  (org_id, staff1_id, 'member'),
  (org_id, staff2_id, 'member'),
  (org_id, client1_id, 'client'),
  (org_id, client2_id, 'client')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 4) Space Memberships
-- =============================================================================
INSERT INTO space_memberships (space_id, user_id, role) VALUES
  (space_id, demo_user_id, 'admin'),
  (space_id, staff1_id, 'editor'),
  (space_id, staff2_id, 'editor'),
  (space_id, client1_id, 'client'),
  (space_id, client2_id, 'client')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 5) Milestones (from original seed)
-- =============================================================================
INSERT INTO milestones (id, org_id, space_id, name, due_date, order_key) VALUES
  (milestone1_id, org_id, space_id, 'フェーズ1: 要件定義', '2024-03-01', 1),
  (milestone2_id, org_id, space_id, 'フェーズ2: 設計', '2024-04-01', 2),
  (milestone3_id, org_id, space_id, 'フェーズ3: 開発', '2024-05-01', 3)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 6) Tasks (Various statuses and ball ownership)
-- =============================================================================

-- Task 1: クライアント確認待ち (ball=client)
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_design_id, org_id, space_id, milestone2_id,
  'トップページデザイン案の確認',
  'デザイナーが作成したトップページのデザイン案をクライアントにご確認いただきたいです。3案ご用意しました。',
  'in_progress', 'client', 'internal', 'task', '2024-02-20', staff1_id)
ON CONFLICT DO NOTHING;

-- Task 2: 検討中タスク (status=considering)
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_wireframe_id, org_id, space_id, milestone1_id,
  'ワイヤーフレーム作成方針',
  'PC/SP両方のワイヤーフレームを作成する方針について検討中です。',
  'considering', 'internal', 'client', 'task', '2024-02-15', demo_user_id)
ON CONFLICT DO NOTHING;

-- Task 3: クライアント起案 (origin=client)
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_logo_id, org_id, space_id, milestone2_id,
  'ロゴの刷新検討',
  '現行ロゴを刷新したいとのご要望。ブランドイメージを維持しつつモダンに。',
  'backlog', 'internal', 'client', 'task', '2024-03-01', staff1_id)
ON CONFLICT DO NOTHING;

-- Task 4: 進行中 (internal担当)
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_api_id, org_id, space_id, milestone3_id,
  'API設計・実装',
  'REST APIの設計とバックエンド実装を行います。',
  'in_progress', 'internal', 'internal', 'task', '2024-04-15', staff2_id)
ON CONFLICT DO NOTHING;

-- Task 5: クライアント確認待ち
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_mobile_id, org_id, space_id, milestone2_id,
  'スマホ対応の優先度確認',
  'SP対応の優先度についてご確認ください。レスポンシブ or ネイティブアプリ？',
  'todo', 'client', 'internal', 'task', '2024-02-25', demo_user_id)
ON CONFLICT DO NOTHING;

-- Task 6: 完了タスク
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_seo_id, org_id, space_id, milestone1_id,
  'SEO要件の整理',
  'SEO対策の要件を整理しました。キーワード選定完了。',
  'done', 'internal', 'internal', 'task', '2024-02-01', demo_user_id)
ON CONFLICT DO NOTHING;

-- Task 7: レビュー待ち
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_hosting_id, org_id, space_id, milestone3_id,
  'ホスティング環境の選定',
  'AWS vs GCP vs Vercel の比較検討結果をレビューしてください。',
  'in_review', 'internal', 'internal', 'task', '2024-03-10', staff2_id)
ON CONFLICT DO NOTHING;

-- Task 8: クライアント確認待ち（緊急）
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id, priority)
VALUES (task_domain_id, org_id, space_id, milestone3_id,
  '【緊急】ドメイン名の最終決定',
  '公開予定日が迫っています。ドメイン名を至急ご決定ください。',
  'todo', 'client', 'internal', 'task', '2024-02-10', demo_user_id, 1)
ON CONFLICT DO NOTHING;

-- Task 9: 未着手
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_content_id, org_id, space_id, milestone2_id,
  'コンテンツ原稿の作成',
  '各ページのコンテンツ原稿を作成します。',
  'backlog', 'internal', 'internal', 'task', '2024-03-15', NULL)
ON CONFLICT DO NOTHING;

-- Task 10: アナリティクス設定
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, due_date, assignee_id)
VALUES (task_analytics_id, org_id, space_id, milestone3_id,
  'Google Analytics設定',
  'GA4の設定とイベントトラッキングの実装。',
  'todo', 'internal', 'internal', 'task', '2024-04-20', staff2_id)
ON CONFLICT DO NOTHING;

-- Task 11: SPEC タスク（検討中）
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, spec_path, decision_state, due_date, assignee_id)
VALUES (task_spec_nav_id, org_id, space_id, milestone2_id,
  'ナビゲーション構造の決定',
  'メインナビゲーションの構造を決定する必要があります。',
  'considering', 'client', 'internal', 'spec', '/spec/navigation#main-nav', 'considering', '2024-02-28', demo_user_id)
ON CONFLICT DO NOTHING;

-- Task 12: SPEC タスク（決定済み）
INSERT INTO tasks (id, org_id, space_id, milestone_id, title, description, status, ball, origin, type, spec_path, decision_state, due_date, assignee_id)
VALUES (task_spec_payment_id, org_id, space_id, milestone3_id,
  '決済方式の仕様',
  'クレジットカード決済の仕様が決定しました。',
  'in_progress', 'internal', 'client', 'spec', '/spec/payment#credit-card', 'decided', '2024-04-01', staff2_id)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 7) Task Owners
-- =============================================================================
INSERT INTO task_owners (org_id, space_id, task_id, side, user_id) VALUES
  -- デザイン案確認: クライアント担当者
  (org_id, space_id, task_design_id, 'client', client1_id),
  (org_id, space_id, task_design_id, 'internal', staff1_id),
  -- スマホ対応: クライアント担当者
  (org_id, space_id, task_mobile_id, 'client', client1_id),
  (org_id, space_id, task_mobile_id, 'client', client2_id),
  (org_id, space_id, task_mobile_id, 'internal', demo_user_id),
  -- ドメイン名: クライアント担当者
  (org_id, space_id, task_domain_id, 'client', client1_id),
  (org_id, space_id, task_domain_id, 'internal', demo_user_id),
  -- ナビゲーション仕様: クライアント担当者
  (org_id, space_id, task_spec_nav_id, 'client', client1_id),
  (org_id, space_id, task_spec_nav_id, 'internal', demo_user_id)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 8) Meetings
-- =============================================================================
INSERT INTO meetings (id, org_id, space_id, title, held_at, status, started_at, ended_at, minutes_md, summary_subject, summary_body)
VALUES
  (meeting1_id, org_id, space_id, 'キックオフミーティング', '2024-01-15 10:00:00+09', 'ended', '2024-01-15 10:00:00+09', '2024-01-15 11:30:00+09',
   '# キックオフミーティング議事録\n\n## 参加者\n- 田中太郎（PM）\n- 鈴木一郎（クライアント）\n\n## 決定事項\n- プロジェクト開始日: 2024/1/15\n- 納期: 2024/5/1',
   'キックオフミーティング完了',
   'プロジェクトのキックオフミーティングを実施しました。'),
  (meeting2_id, org_id, space_id, 'デザインレビュー会議', '2024-02-10 14:00:00+09', 'ended', '2024-02-10 14:00:00+09', '2024-02-10 15:00:00+09',
   '# デザインレビュー\n\n## 確認事項\n- トップページデザイン案A/B/Cを提示\n- クライアント様にて検討中',
   'デザインレビュー完了',
   'デザイン案3点を提示。クライアント様にてご検討いただきます。'),
  (meeting3_id, org_id, space_id, '次回定例会議', '2024-02-20 10:00:00+09', 'planned', NULL, NULL, NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 9) Meeting Participants
-- =============================================================================
INSERT INTO meeting_participants (org_id, space_id, meeting_id, user_id, side) VALUES
  (org_id, space_id, meeting1_id, demo_user_id, 'internal'),
  (org_id, space_id, meeting1_id, client1_id, 'client'),
  (org_id, space_id, meeting2_id, demo_user_id, 'internal'),
  (org_id, space_id, meeting2_id, staff1_id, 'internal'),
  (org_id, space_id, meeting2_id, client1_id, 'client'),
  (org_id, space_id, meeting2_id, client2_id, 'client'),
  (org_id, space_id, meeting3_id, demo_user_id, 'internal'),
  (org_id, space_id, meeting3_id, client1_id, 'client')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 10) Reviews
-- =============================================================================
INSERT INTO reviews (id, org_id, space_id, task_id, status, created_by) VALUES
  (review1_id, org_id, space_id, task_hosting_id, 'open', staff2_id),
  (review2_id, org_id, space_id, task_seo_id, 'approved', demo_user_id)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 11) Review Approvals
-- =============================================================================
INSERT INTO review_approvals (org_id, review_id, reviewer_id, state) VALUES
  (org_id, review1_id, demo_user_id, 'pending'),
  (org_id, review1_id, staff1_id, 'pending'),
  (org_id, review2_id, staff1_id, 'approved')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 12) Task Events (Audit Log)
-- =============================================================================
INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload, created_at) VALUES
  -- デザイン案作成イベント
  (org_id, space_id, task_design_id, staff1_id, NULL, 'TASK_CREATE', '{"title": "トップページデザイン案の確認"}'::jsonb, '2024-02-05 09:00:00+09'),
  -- ボールをクライアントへ
  (org_id, space_id, task_design_id, demo_user_id, meeting2_id, 'PASS_BALL', '{"from": "internal", "to": "client", "reason": "デザイン案をご確認ください"}'::jsonb, '2024-02-10 15:00:00+09'),
  -- スマホ対応タスク作成
  (org_id, space_id, task_mobile_id, demo_user_id, NULL, 'TASK_CREATE', '{"title": "スマホ対応の優先度確認"}'::jsonb, '2024-02-08 10:00:00+09'),
  -- ドメイン名タスク作成
  (org_id, space_id, task_domain_id, demo_user_id, NULL, 'TASK_CREATE', '{"title": "ドメイン名の最終決定", "priority": 1}'::jsonb, '2024-02-09 11:00:00+09'),
  -- レビュー開始
  (org_id, space_id, task_hosting_id, staff2_id, NULL, 'REVIEW_OPEN', '{"reviewer_ids": ["' || demo_user_id::text || '", "' || staff1_id::text || '"]}'::jsonb, '2024-03-08 16:00:00+09')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 13) Notifications (受信トレイに表示される通知)
-- =============================================================================

-- Demo user (田中太郎) への通知
INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at, read_at) VALUES
  -- 1. スタッフからのレビュー依頼
  (org_id, space_id, demo_user_id, 'in_app', 'review_request',
   'review_request_' || task_hosting_id::text,
   jsonb_build_object(
     'title', 'レビュー依頼',
     'message', '山田次郎さんが「ホスティング環境の選定」のレビューを依頼しました',
     'task_id', task_hosting_id,
     'task_title', 'ホスティング環境の選定',
     'from_user_name', '山田 次郎',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_hosting_id::text
   ),
   now() - interval '2 hours', NULL),

  -- 2. クライアントからの質問
  (org_id, space_id, demo_user_id, 'in_app', 'client_question',
   'client_question_' || task_design_id::text || '_1',
   jsonb_build_object(
     'title', 'クライアントからの質問',
     'message', '鈴木一郎さんが「トップページデザイン案の確認」について質問があります',
     'task_id', task_design_id,
     'task_title', 'トップページデザイン案の確認',
     'from_user_name', '鈴木 一郎',
     'question', 'A案とB案の制作費用の違いを教えてください',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_design_id::text
   ),
   now() - interval '4 hours', NULL),

  -- 3. タスクのアサイン通知
  (org_id, space_id, demo_user_id, 'in_app', 'task_assigned',
   'task_assigned_' || task_wireframe_id::text,
   jsonb_build_object(
     'title', 'タスクが割り当てられました',
     'message', '「ワイヤーフレーム作成方針」があなたに割り当てられました',
     'task_id', task_wireframe_id,
     'task_title', 'ワイヤーフレーム作成方針',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_wireframe_id::text
   ),
   now() - interval '1 day', NULL),

  -- 4. 期限が近いタスク
  (org_id, space_id, demo_user_id, 'in_app', 'due_date_reminder',
   'due_date_' || task_domain_id::text,
   jsonb_build_object(
     'title', '期限が近づいています',
     'message', '「ドメイン名の最終決定」の期限が2日後です',
     'task_id', task_domain_id,
     'task_title', 'ドメイン名の最終決定',
     'due_date', '2024-02-10',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_domain_id::text
   ),
   now() - interval '6 hours', NULL),

  -- 5. 会議リマインダー
  (org_id, space_id, demo_user_id, 'in_app', 'meeting_reminder',
   'meeting_reminder_' || meeting3_id::text,
   jsonb_build_object(
     'title', '会議リマインダー',
     'message', '「次回定例会議」が明日 10:00 に予定されています',
     'meeting_id', meeting3_id,
     'meeting_title', '次回定例会議',
     'scheduled_at', '2024-02-20T10:00:00+09:00',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010/meetings?meeting=' || meeting3_id::text
   ),
   now() - interval '12 hours', NULL),

  -- 6. 仕様決定依頼（SPEC タスク）
  (org_id, space_id, demo_user_id, 'in_app', 'spec_decision_needed',
   'spec_decision_' || task_spec_nav_id::text,
   jsonb_build_object(
     'title', '仕様決定が必要です',
     'message', '「ナビゲーション構造の決定」についてクライアント様の決定をお待ちしています',
     'task_id', task_spec_nav_id,
     'task_title', 'ナビゲーション構造の決定',
     'spec_path', '/spec/navigation#main-nav',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_spec_nav_id::text
   ),
   now() - interval '3 hours', NULL),

  -- 7. 既読の通知（タスク完了）
  (org_id, space_id, demo_user_id, 'in_app', 'task_completed',
   'task_completed_' || task_seo_id::text,
   jsonb_build_object(
     'title', 'タスク完了',
     'message', '「SEO要件の整理」が完了しました',
     'task_id', task_seo_id,
     'task_title', 'SEO要件の整理',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_seo_id::text
   ),
   now() - interval '3 days', now() - interval '2 days'),

  -- 8. ボールが戻ってきた通知
  (org_id, space_id, demo_user_id, 'in_app', 'ball_passed',
   'ball_passed_' || task_logo_id::text,
   jsonb_build_object(
     'title', 'タスクがあなたに戻りました',
     'message', '鈴木一郎さんが「ロゴの刷新検討」のボールをあなたに渡しました',
     'task_id', task_logo_id,
     'task_title', 'ロゴの刷新検討',
     'from_user_name', '鈴木 一郎',
     'comment', 'ロゴ案について社内で検討しました。方向性は承認です。',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_logo_id::text
   ),
   now() - interval '1 hour', NULL)
ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

-- Staff1 (佐藤花子) への通知
INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at, read_at) VALUES
  (org_id, space_id, staff1_id, 'in_app', 'review_request',
   'review_request_' || task_hosting_id::text,
   jsonb_build_object(
     'title', 'レビュー依頼',
     'message', '山田次郎さんが「ホスティング環境の選定」のレビューを依頼しました',
     'task_id', task_hosting_id,
     'task_title', 'ホスティング環境の選定',
     'from_user_name', '山田 次郎',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_hosting_id::text
   ),
   now() - interval '2 hours', NULL),

  (org_id, space_id, staff1_id, 'in_app', 'client_feedback',
   'client_feedback_' || task_design_id::text,
   jsonb_build_object(
     'title', 'クライアントフィードバック',
     'message', '高橋美咲さんが「トップページデザイン案の確認」にコメントしました',
     'task_id', task_design_id,
     'task_title', 'トップページデザイン案の確認',
     'from_user_name', '高橋 美咲',
     'comment', 'B案の色味をもう少し明るくできますか？',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_design_id::text
   ),
   now() - interval '30 minutes', NULL)
ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

-- Client1 (鈴木一郎) への通知
INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at, read_at) VALUES
  (org_id, space_id, client1_id, 'in_app', 'confirmation_request',
   'confirmation_' || task_design_id::text,
   jsonb_build_object(
     'title', 'ご確認依頼',
     'message', '「トップページデザイン案の確認」についてご確認をお願いします',
     'task_id', task_design_id,
     'task_title', 'トップページデザイン案の確認',
     'from_user_name', '田中 太郎',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_design_id::text
   ),
   now() - interval '5 hours', NULL),

  (org_id, space_id, client1_id, 'in_app', 'confirmation_request',
   'confirmation_' || task_mobile_id::text,
   jsonb_build_object(
     'title', 'ご確認依頼',
     'message', '「スマホ対応の優先度確認」についてご確認をお願いします',
     'task_id', task_mobile_id,
     'task_title', 'スマホ対応の優先度確認',
     'from_user_name', '田中 太郎',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_mobile_id::text
   ),
   now() - interval '1 day', NULL),

  (org_id, space_id, client1_id, 'in_app', 'urgent_confirmation',
   'urgent_' || task_domain_id::text,
   jsonb_build_object(
     'title', '【緊急】ご確認依頼',
     'message', '「ドメイン名の最終決定」について至急ご確認をお願いします',
     'task_id', task_domain_id,
     'task_title', 'ドメイン名の最終決定',
     'from_user_name', '田中 太郎',
     'urgent', true,
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010?task=' || task_domain_id::text
   ),
   now() - interval '3 hours', NULL),

  (org_id, space_id, client1_id, 'in_app', 'meeting_scheduled',
   'meeting_scheduled_' || meeting3_id::text,
   jsonb_build_object(
     'title', '会議のご案内',
     'message', '「次回定例会議」が 2024/02/20 10:00 に予定されています',
     'meeting_id', meeting3_id,
     'meeting_title', '次回定例会議',
     'scheduled_at', '2024-02-20T10:00:00+09:00',
     'link', '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010/meetings?meeting=' || meeting3_id::text
   ),
   now() - interval '2 days', now() - interval '1 day')
ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

END $$;

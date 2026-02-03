-- Seed data for TaskApp local development
-- Note: Demo user must be created via Auth API before running this seed
-- Run this after seeding to create demo user:
--   curl -s 'http://127.0.0.1:54321/auth/v1/admin/users' \
--     -H 'apikey: <SERVICE_ROLE_KEY>' \
--     -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
--     -H 'Content-Type: application/json' \
--     -d '{"email":"demo@example.com","password":"demo1234","email_confirm":true}'
-- Demo user ID used in development: see useTasks.ts

-- Demo organization
INSERT INTO organizations (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'デモ組織')
ON CONFLICT DO NOTHING;

-- Demo space (project)
INSERT INTO spaces (id, org_id, type, name) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'project', 'Web サイト開発')
ON CONFLICT DO NOTHING;

-- Demo milestones
INSERT INTO milestones (id, org_id, space_id, name, due_date, order_key) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'フェーズ1: 要件定義', '2024-03-01', 1),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'フェーズ2: 設計', '2024-04-01', 2),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'フェーズ3: 開発', '2024-05-01', 3)
ON CONFLICT DO NOTHING;

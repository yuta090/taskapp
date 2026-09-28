-- =============================================================================
-- 「承認がそろったらタスクを完了にする」（*_review_auto_complete.sql）の検証用データ
-- run_review_auto_complete.sh が、本 migration の手前までの migrations のあと・本 migration の前に流す。
--
-- 人物・組織・プロジェクト・タスク T1〜T8 は review_result_notify_seed.sql をそのまま使う。
-- 本テスト用に足すタスク:
--   T9  未決の決定事項タスク（spec / considering）… 承認がそろっても完了にできない（先に「決定にする」が要る）
--   T10 すでに完了しているタスク            … 承認がそろっても触らない
-- =============================================================================

\ir review_result_notify_seed.sql

insert into public.tasks
  (id, org_id, space_id, title, status, ball, origin, type, spec_path, decision_state, created_by, assignee_id)
values
  ('d0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   '未決の決定事項', 'in_progress', 'internal', 'internal', 'spec', 'docs/spec/example.md', 'considering',
   'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004'),
  ('d0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'もう完了しているタスク', 'done', 'internal', 'internal', 'task', null, null,
   'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

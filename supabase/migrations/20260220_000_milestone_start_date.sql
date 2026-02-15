-- ============================================================================
-- Migration: Add start_date to milestones + burndown query index
-- Description: バーンダウンチャート前提のマイルストーン開始日追加
-- Created: 2026-02-14
-- Spec: docs/spec/BURNDOWN_SPEC.md v1.5
-- ============================================================================

-- 1. マイルストーンに開始日を追加
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS start_date date NULL;

-- 2. バリデーション: start_date <= due_date
ALTER TABLE milestones ADD CONSTRAINT milestones_date_order
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

-- 3. バーンダウン集計クエリ高速化用インデックス
CREATE INDEX IF NOT EXISTS audit_logs_burndown_idx
  ON audit_logs (space_id, target_type, event_type, occurred_at ASC)
  WHERE target_type = 'task';

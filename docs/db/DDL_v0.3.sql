-- Postgres DDL v0.3 (Migration + Activity Log)
-- Apply on top of DDL v0.2
--
-- Adds
-- - activity_log: AIが追跡しやすい汎用アクティビティログ
-- - 各テーブルへのcreated_by/updated_by追加
-- - 検索用インデックス
-- - AI向けRPC関数
--
-- Notes
-- - AI（Claude/GPT）やMCPサーバー経由の操作を追跡
-- - バグチェック・デバッグ用途を想定

-- =============================================================================
-- 1) activity_log (汎用アクティビティログ)
-- =============================================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- いつ
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- だれが
  actor_id uuid NULL,
  actor_type text NOT NULL DEFAULT 'user', -- user | system | ai | service
  actor_service text NULL,                 -- MCP/Claude/GPT/automation など
  request_id uuid NULL,                    -- 1回の操作単位で相関
  session_id uuid NULL,                    -- 対話・セッション相関
  ip_address inet NULL,
  user_agent text NULL,

  -- どのテーブルのどのレコード
  entity_schema text NOT NULL DEFAULT 'public',
  entity_table text NOT NULL,
  entity_id uuid NULL,                     -- UUID以外を扱う場合は entity_key を併用
  entity_key text NULL,                    -- 文字列キーなど
  entity_display text NULL,                -- AI/UIで見やすい名前

  -- 何をどうしたか
  action text NOT NULL,                    -- insert | update | delete | upsert | soft_delete | restore | merge など
  reason text NULL,                        -- 変更理由/AIの意図
  status text NOT NULL DEFAULT 'ok',       -- ok | error | warning

  -- 変更差分（AIが追跡しやすい形）
  changed_fields text[] NULL,              -- 更新対象の列名
  before_data jsonb NULL,                  -- 更新前のスナップショット
  after_data jsonb NULL,                   -- 更新後のスナップショット
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, -- 追加メタ情報（自由形式）

  -- 参照系
  related_table text NULL,                 -- 関連先
  related_id uuid NULL,
  organization_id uuid NULL,               -- 主要スコープ
  space_id uuid NULL,

  -- 論理削除
  is_deleted boolean NOT NULL DEFAULT false
);

-- =============================================================================
-- 2) 各テーブルへのcreated_by/updated_by追加
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

ALTER TABLE milestones
  ADD COLUMN IF NOT EXISTS org_id uuid NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL DEFAULT now();

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

ALTER TABLE task_owners
  ADD COLUMN IF NOT EXISTS created_by uuid NULL;

ALTER TABLE meeting_participants
  ADD COLUMN IF NOT EXISTS created_by uuid NULL;

ALTER TABLE review_approvals
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS created_by uuid NULL;

-- =============================================================================
-- 3) インデックス
-- =============================================================================

-- activity_log 主要検索
CREATE INDEX IF NOT EXISTS activity_log_entity_idx
  ON activity_log (entity_table, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_actor_idx
  ON activity_log (actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_request_idx
  ON activity_log (request_id);

CREATE INDEX IF NOT EXISTS activity_log_session_idx
  ON activity_log (session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_org_space_idx
  ON activity_log (organization_id, space_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_action_idx
  ON activity_log (action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_occurred_at_idx
  ON activity_log (occurred_at DESC);

-- JSONB検索（payload/after_data）
CREATE INDEX IF NOT EXISTS activity_log_payload_gin
  ON activity_log USING gin (payload jsonb_path_ops);

CREATE INDEX IF NOT EXISTS activity_log_after_gin
  ON activity_log USING gin (after_data jsonb_path_ops);

-- =============================================================================
-- 4) AI向けビュー
-- =============================================================================

CREATE OR REPLACE VIEW activity_log_readable AS
SELECT
  id,
  occurred_at,
  actor_id,
  actor_type,
  actor_service,
  request_id,
  session_id,
  entity_table,
  entity_id,
  entity_display,
  action,
  reason,
  status,
  changed_fields,
  before_data,
  after_data,
  payload,
  organization_id,
  space_id
FROM activity_log
WHERE is_deleted = false;

-- =============================================================================
-- 5) AI向けRPC関数
-- =============================================================================

-- アクティビティログ検索
CREATE OR REPLACE FUNCTION rpc_search_activity_log(
  p_entity_table text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_org uuid DEFAULT NULL,
  p_space uuid DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS SETOF activity_log
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM activity_log
  WHERE (p_entity_table IS NULL OR entity_table = p_entity_table)
    AND (p_entity_id IS NULL OR entity_id = p_entity_id)
    AND (p_actor_id IS NULL OR actor_id = p_actor_id)
    AND (p_action IS NULL OR action = p_action)
    AND (p_org IS NULL OR organization_id = p_org)
    AND (p_space IS NULL OR space_id = p_space)
    AND (p_from IS NULL OR occurred_at >= p_from)
    AND (p_to IS NULL OR occurred_at <= p_to)
    AND is_deleted = false
  ORDER BY occurred_at DESC
  LIMIT p_limit;
$$;

-- 特定エンティティの履歴取得
CREATE OR REPLACE FUNCTION rpc_get_entity_history(
  p_table text,
  p_id uuid,
  p_limit int DEFAULT 50
)
RETURNS SETOF activity_log
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM activity_log
  WHERE entity_table = p_table
    AND entity_id = p_id
    AND is_deleted = false
  ORDER BY occurred_at DESC
  LIMIT p_limit;
$$;

-- セッション内の操作履歴取得
CREATE OR REPLACE FUNCTION rpc_get_session_activity(
  p_session_id uuid,
  p_limit int DEFAULT 100
)
RETURNS SETOF activity_log
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM activity_log
  WHERE session_id = p_session_id
    AND is_deleted = false
  ORDER BY occurred_at DESC
  LIMIT p_limit;
$$;

-- アクティビティログ記録
CREATE OR REPLACE FUNCTION rpc_log_activity(
  p_entity_table text,
  p_entity_id uuid,
  p_action text,
  p_actor_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'user',
  p_actor_service text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_entity_display text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_status text DEFAULT 'ok',
  p_changed_fields text[] DEFAULT NULL,
  p_before_data jsonb DEFAULT NULL,
  p_after_data jsonb DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_org_id uuid DEFAULT NULL,
  p_space_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO activity_log (
    actor_id,
    actor_type,
    actor_service,
    request_id,
    session_id,
    entity_table,
    entity_id,
    entity_display,
    action,
    reason,
    status,
    changed_fields,
    before_data,
    after_data,
    payload,
    organization_id,
    space_id
  ) VALUES (
    p_actor_id,
    p_actor_type,
    p_actor_service,
    p_request_id,
    p_session_id,
    p_entity_table,
    p_entity_id,
    p_entity_display,
    p_action,
    p_reason,
    p_status,
    p_changed_fields,
    p_before_data,
    p_after_data,
    p_payload,
    p_org_id,
    p_space_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

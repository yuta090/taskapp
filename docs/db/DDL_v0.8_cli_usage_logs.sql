-- DDL v0.8: CLI Usage Logs
-- CLI コマンドの利用統計を記録するテーブル

CREATE TABLE IF NOT EXISTS cli_usage_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id    uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  org_id        uuid NOT NULL,
  space_id      uuid,
  user_id       uuid,
  tool_name     text NOT NULL,
  status        text NOT NULL DEFAULT 'success',  -- 'success' | 'error'
  error_message text,
  response_ms   integer,                          -- response time in ms
  cli_version   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_cli_usage_logs_org_id     ON cli_usage_logs (org_id);
CREATE INDEX idx_cli_usage_logs_tool_name  ON cli_usage_logs (tool_name);
CREATE INDEX idx_cli_usage_logs_created_at ON cli_usage_logs (created_at DESC);
CREATE INDEX idx_cli_usage_logs_org_tool   ON cli_usage_logs (org_id, tool_name, created_at DESC);

-- RLS: only service_role can insert (fire-and-forget from API route)
ALTER TABLE cli_usage_logs ENABLE ROW LEVEL SECURITY;

-- No RLS policies = only service_role (admin client) can access
-- Dashboard queries will use admin client

COMMENT ON TABLE cli_usage_logs IS 'CLI (agentpm) command usage statistics per customer';

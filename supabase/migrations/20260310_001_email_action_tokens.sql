-- メール承認トークン: ログイン不要でメールからワンクリック承認を可能にする
-- トークンは1回限り有効、7日間で失効

CREATE TABLE IF NOT EXISTS email_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  space_id uuid NOT NULL,
  org_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  recipient_email text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('approve', 'estimate_approve')),
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- トークン検索用（メールリンククリック時）
CREATE INDEX IF NOT EXISTS idx_email_action_tokens_token
  ON email_action_tokens(token);

-- 期限切れトークンのクリーンアップ用
CREATE INDEX IF NOT EXISTS idx_email_action_tokens_cleanup
  ON email_action_tokens(expires_at)
  WHERE used_at IS NULL;

-- 同一タスク・ユーザーへの重複送信防止用
CREATE INDEX IF NOT EXISTS idx_email_action_tokens_task_user
  ON email_action_tokens(task_id, recipient_user_id)
  WHERE used_at IS NULL;

-- RLS: service_role のみアクセス（API route からのみ操作）
ALTER TABLE email_action_tokens ENABLE ROW LEVEL SECURITY;

-- service_role はRLSをバイパスするため、明示的なポリシーは不要
-- anon/authenticated ユーザーからの直接アクセスは全てブロック

COMMENT ON TABLE email_action_tokens IS 'メール承認用ワンタイムトークン。ログイン不要で承認操作を可能にする';
COMMENT ON COLUMN email_action_tokens.token IS 'URLに含まれるトークン文字列（256bit hex）';
COMMENT ON COLUMN email_action_tokens.action_type IS '承認アクション種別: approve=タスク承認, estimate_approve=見積もり承認';
COMMENT ON COLUMN email_action_tokens.used_at IS '使用日時（NULLなら未使用）';

-- =============================================================================
-- Slack OAuth Integration
-- 組織ごとのSlack Bot Tokenを暗号化して管理
-- =============================================================================

-- pgcrypto拡張を有効化（既に有効な場合はスキップ）
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) slack_workspaces にOAuth関連カラムを追加
-- -----------------------------------------------------------------------------
alter table slack_workspaces
  add column if not exists bot_token_encrypted text,
  add column if not exists bot_user_id text,
  add column if not exists app_id text,
  add column if not exists scope text,
  add column if not exists installed_by uuid references auth.users(id),
  add column if not exists token_obtained_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2) トークン暗号化/復号化関数
-- -----------------------------------------------------------------------------

-- 暗号化
create or replace function encrypt_slack_token(token text, secret text)
returns text as $$
  select encode(pgp_sym_encrypt(token, secret), 'base64');
$$ language sql security definer;

-- 復号化
create or replace function decrypt_slack_token(encrypted text, secret text)
returns text as $$
  select pgp_sym_decrypt(decode(encrypted, 'base64'), secret);
$$ language sql security definer;

-- -----------------------------------------------------------------------------
-- 3) bot_token_encrypted をSELECTポリシーから除外するためのビュー（任意）
-- RLSポリシーは既存のまま（ownerのみ書き込み、memberは閲覧可）
-- bot_token_encrypted は API経由でのみ使用し、直接SELECTしない設計
-- -----------------------------------------------------------------------------

-- org_ownersのみがworkspaceのtoken関連を更新できるポリシー
-- 既存の "org owners can manage slack workspaces" ポリシーでカバー済み

comment on column slack_workspaces.bot_token_encrypted is 'pgcrypto暗号化済みBot Token。SLACK_CLIENT_SECRETをキーとして使用。';
comment on column slack_workspaces.bot_user_id is 'OAuth応答から取得したBot User ID';
comment on column slack_workspaces.app_id is 'Slack App ID（OAuth応答から自動取得）';
comment on column slack_workspaces.scope is 'OAuth認証時に付与されたスコープ一覧';
comment on column slack_workspaces.installed_by is 'OAuthまたは手動入力を実行したユーザー';
comment on column slack_workspaces.token_obtained_at is 'トークン取得日時';

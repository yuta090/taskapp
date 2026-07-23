-- =============================================================================
-- integration_connections: 秘密列の列レベル SELECT を revoke【contract フェーズ M3】
--
-- 【背景】
-- integration_connections は RLS で「org owner は自組織の org 接続を SELECT できる」。RLS は
-- **行**は絞るが**列**は絞らないため、org owner が access_token_encrypted /
-- refresh_token_encrypted(および contract 後は空になる平文列)まで直接 SELECT できてしまう。
-- トークンの実体は暗号化されているとはいえ、秘密列はアプリ(service_role)以外に見せる必要が
-- 一切ない。ここで authenticated/anon の**列レベル**SELECT を秘密4列だけ落とす(fail-closed)。
-- service_role(サーバ内のトークン解決・refresh)は列制限の対象外なので影響しない。
--
-- 秘密4列(GRANT から除外):
--   access_token, refresh_token, access_token_encrypted, refresh_token_encrypted
--
-- 【列リストの確定方法 — レビュー用に明記】
-- worktree では本番の \d が見られないため、supabase/migrations/ の全 DDL を追って
-- integration_connections の現在の全列を復元し、そこから秘密4列を除いて列挙した。追った DDL:
--   - 20260214_000_integration_connections.sql (create table)
--       id, provider, owner_type, owner_id, org_id, access_token(秘匿),
--       refresh_token(秘匿), token_expires_at, scopes, metadata, status,
--       last_refreshed_at, created_at, updated_at
--   - 20260717075717_encrypt_integration_connection_tokens.sql
--       access_token_encrypted(秘匿), refresh_token_encrypted(秘匿)
--   - 20260718092110_google_tasks_mirror.sql               … provider チェック追加のみ(列追加なし)
--   - 20260720125427_connector_two_way_sync.sql
--       import_enabled, import_config, poll_cursor
--   - 20260721133427_due_reminder_pr0.sql
--       last_import_success_at
--   - 20260721193711_task_sync_credentials.sql
--       auth_kind, base_url, external_account_key
--   - 20260721202155_task_sync_poll_attempt.sql
--       last_poll_attempt_at
--   - 20260722080305_task_sync_missing_containers.sql
--       import_missing_containers
--   - 20260723034540_missing_containers_pending_config_reason.sql … comment のみ(列追加なし)
-- 上記から秘密4列を除いた 21 列を GRANT する。status route
-- (src/app/api/integrations/status/route.ts)が select している列
-- (id, provider, owner_type, owner_id, org_id, scopes, metadata, status,
--  token_expires_at, last_refreshed_at, created_at, updated_at)は全て含まれている。
-- ⚠ 適用前に本番の \d public.integration_connections と突き合わせて列の抜けが無いか確認すること
--   (列を1つでも見落とすと authenticated の正当な読みが permission denied で壊れる)。
--
-- 【将来この表に列を足すときの注意 — fail-closed】
-- 列レベル GRANT を使う表では、後から足した列は authenticated に **自動では見えない**。
-- authenticated に読ませたい非秘密列を足したら、その列を明示的に GRANT SELECT すること。
-- 秘密列なら GRANT しないのが正しい(デフォルトで隠れる = 安全側)。
--
-- 【可逆性】revoke/grant はいつでも即座に戻せる(データは変わらない)。
-- INSERT/UPDATE/DELETE の権限には一切触らない(SELECT だけを絞る)。
-- =============================================================================

-- 表レベルの SELECT を一旦落として、列レベルへ張り替える(fail-closed)。
revoke select on table public.integration_connections from authenticated, anon;

-- 非秘密 21 列だけ authenticated に SELECT を許可する。anon には許可しない(元々 org 情報を
-- anon に見せる必要はない)。秘密4列(access_token/refresh_token/*_encrypted)は含めない。
grant select (
  id,
  provider,
  owner_type,
  owner_id,
  org_id,
  token_expires_at,
  scopes,
  metadata,
  status,
  last_refreshed_at,
  created_at,
  updated_at,
  import_enabled,
  import_config,
  poll_cursor,
  auth_kind,
  base_url,
  external_account_key,
  last_poll_attempt_at,
  import_missing_containers,
  last_import_success_at
) on table public.integration_connections to authenticated;

-- =============================================================================
-- Microsoft Teams 受信（拾い成立）PR-1: 入口＋claim bootstrap — 器の追加
-- 設計: docs/spec（Fable裁定・Teams inbound architecture）。
--
-- 本PRのスコープはアプリ側（Bot Framework messaging endpoint + claim bootstrap）のみ。
-- 本 migration は以下の「器」だけを加算する:
--   1) channel_groups.metadata — serviceUrl/teamId/tenantId 等をPR-2以降で保存するための列
--      （NULL可・既存行は無変更）。本PR時点ではコードから書き込まない（redeemCodeOnlyClaim等の
--      RPCはmetadata引数を持たないため）。PR-2で書き込み経路を追加する前提の先行追加。
--   2) teams の platform 共有アカウント(channel_accounts)行 — ★このmigrationでは作らない。
--      理由（重要・設計からの意図的逸脱）: channel_accounts.credentials_encrypted は NOT NULL
--      であり、既存の暗号化関数 encrypt_system_secret(plaintext, secret) の secret 引数には
--      SYSTEM_ENCRYPTION_KEY（本番の実キー）が必要。migration SQL にこの実キーを平文/リテラルで
--      埋め込むことはできない（版管理された migration ファイルに秘匿鍵が永久に残る）。
--      既存の platform account 投入も同じ理由でmigrationでは行われておらず、専用スクリプト
--      （scripts/seed-platform-google-chat-account.mjs）が .env.local の SYSTEM_ENCRYPTION_KEY を
--      実行時に読んで投入している。Teams も同型の scripts/seed-platform-teams-account.mjs を
--      別途用意し、本 migration 適用後に運用者が手動実行する（Google Chat と同じ運用契約）。
--
-- channel/channel_accounts/channel_groups の channel check 制約には既に 'teams' が含まれている
-- （20260720063041_channel_registry_widen.sql）ため、制約追加は不要。
-- =============================================================================

alter table public.channel_groups
  add column if not exists metadata jsonb;

comment on column public.channel_groups.metadata is
  'チャネル固有の付帯情報（例: Teams の serviceUrl/teamId/tenantId）。PR-1時点では未使用の器（NULL）。書き込みはPR-2以降で追加する';

-- =============================================================================
-- 検証（適用後・service role）:
--   1) 既存 channel_groups 全行の metadata が NULL のままであること（既存行無変更）:
--        select count(*) from channel_groups where metadata is not null;  -- 0
--   2) 新規 insert で metadata に任意JSONを入れられること（PR-2以降で使用）。
--   3) channel_accounts/channel_groups/channel_messages への channel='teams' の insert が
--      チェック制約で拒否されないこと（既に許可済み・本migrationでは変更なし）。
--   4) migration適用後、運用者が scripts/seed-platform-teams-account.mjs を実行し、
--      owner_type='platform'・channel='teams' の channel_accounts 行が1つ作られること
--      （二重実行しても増えない＝冪等）。
-- ロールバック（不可逆な点なし）:
--   alter table public.channel_groups drop column if exists metadata;
-- =============================================================================

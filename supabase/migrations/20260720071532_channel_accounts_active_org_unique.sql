-- =============================================================================
-- channel_accounts: 同一 org×channel に active な org account を1件に強制する部分一意index
--
-- 背景: 資格情報登録API（POST /api/channels/accounts）は「既存 active org account が
--   あればローテート、無ければ新規作成」する。だがこの不変条件はこれまでコードの前提に
--   すぎず、DB では担保されていなかった（既存 index は channel_accounts_line_bot_unique
--   ＝(channel, line_bot_user_id) where line_bot_user_id is not null のみ。非LINEは
--   line_bot_user_id=NULL なので効かない）。
--
--   このため「無効化→再接続」や並行POSTで active な org account が同一 org×channel に
--   複数生成され、GET(findChannelAccountMetaForOrg, created_at asc limit 1)が誤って
--   古い行を返す/送信・webhook解決が非決定的になる不整合が起きうる。
--
-- 対策: owner_type='org' かつ status='active' に限定した部分一意index。
--   - platform（共有bot・org_id=NULL）は owner_type で除外され影響を受けない。
--   - disabled は制約対象外（履歴として複数残ってよい。再接続時はアプリが既存行を再利用）。
--   - 既存の LINE org account は findLineAccountForOrg が maybeSingle で「org×line の
--     active は最大1件」を既に前提にしているため、この制約は既存不変条件の明文化であり
--     既存データと矛盾しない。
--
-- 加算のみ・既存行無変更。並行INSERTの敗者は 23505 になり、アプリ側で
-- 「既存activeを再取得してUPDATE(ローテート)」にフォールバックする（store.ts）。
-- =============================================================================

create unique index if not exists channel_accounts_active_org_channel_unique
  on public.channel_accounts (org_id, channel)
  where owner_type = 'org' and status = 'active';

comment on index public.channel_accounts_active_org_channel_unique is
  '同一 org×channel の active な org account を1件に強制（資格情報登録の重複active防止）。platform/disabledは対象外';

-- ロールバック:
--   drop index if exists public.channel_accounts_active_org_channel_unique;

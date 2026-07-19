-- =============================================================================
-- チャネルレジストリ拡張: 主要チャットを channel check 制約に追加
--   (src/lib/channels/registry.ts の ALL_CHANNEL_IDS と一致させる)
--
-- 既存許容: line, email, chatwork, slack, google_chat
-- 追加:     discord, telegram, teams, whatsapp, messenger
--
-- 変更対象の check 制約（インライン定義なので Postgres 既定名 <table>_channel_check）:
--   channel_accounts / channel_identities / channel_link_codes / channel_messages / channel_groups
-- グループ宛送信に対応しない whatsapp/messenger は channel_groups には足さない
-- （registry の group=false と一致。DM専用チャネルはグループ表に入れない）。
--
-- 非破壊: 制約の許容集合を広げるだけ。既存行は全て新集合の部分集合なので再検証を通る。
-- =============================================================================

-- 全チャネル（背骨のログ/資格情報/紐付け/コード）
alter table public.channel_accounts   drop constraint if exists channel_accounts_channel_check;
alter table public.channel_accounts   add  constraint channel_accounts_channel_check
  check (channel in ('line','email','chatwork','slack','google_chat','discord','telegram','teams','whatsapp','messenger'));

alter table public.channel_identities drop constraint if exists channel_identities_channel_check;
alter table public.channel_identities add  constraint channel_identities_channel_check
  check (channel in ('line','email','chatwork','slack','google_chat','discord','telegram','teams','whatsapp','messenger'));

alter table public.channel_link_codes drop constraint if exists channel_link_codes_channel_check;
alter table public.channel_link_codes add  constraint channel_link_codes_channel_check
  check (channel in ('line','email','chatwork','slack','google_chat','discord','telegram','teams','whatsapp','messenger'));

alter table public.channel_messages   drop constraint if exists channel_messages_channel_check;
alter table public.channel_messages   add  constraint channel_messages_channel_check
  check (channel in ('line','email','chatwork','slack','google_chat','discord','telegram','teams','whatsapp','messenger'));

-- グループ宛（DM専用の whatsapp/messenger と email は含めない）
alter table public.channel_groups     drop constraint if exists channel_groups_channel_check;
alter table public.channel_groups     add  constraint channel_groups_channel_check
  check (channel in ('line','chatwork','slack','google_chat','discord','telegram','teams'));

-- =============================================================================
-- 検証（適用後）:
--   1) channel_messages に channel='telegram' の INSERT が通る
--   2) channel='myspace' 等の未登録値は依然として拒否される
--   3) 既存の channel='line' 行はそのまま（再検証エラーが出ない）
-- ロールバック（許容集合を元に戻す）:
--   各 add constraint を旧集合 ('line','email','chatwork','slack','google_chat') / groups は
--   ('line','chatwork','slack','google_chat') に戻して再作成する。
--   ただし新チャネルの行が既に存在する場合はロールバック不可（先に該当行を退避すること）。
-- =============================================================================

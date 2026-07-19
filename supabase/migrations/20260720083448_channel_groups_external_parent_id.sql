-- =============================================================================
-- channel_groups: 親コンテナID（external_parent_id）を追加
--
-- 背景: Discord 受信（共有プラットフォームBot・Gateway経由）を LINE 共有bot と同じ
--   channel_groups / channel_group_claims 機構で扱う（新テーブルを作らない）。Discord では
--   claim 単位を「テキストチャンネル」にする（external_group_id = channel snowflake）。
--   チャンネルが属する「サーバー(guild)」を保持しておくと、退出処理・将来の guild 単位上限・
--   運用可視化に使える。LINE には親コンテナの概念が無いため NULL。
--
-- 方針: 加算のみ・nullable。既存行・既存 unique(active) 制約(account_id, external_group_id)は
--   無変更（Discord snowflake はグローバル一意なので channel 単位の unique がそのまま成立する）。
--   親IDは一意制約に含めない（帰属確定は external_group_id 側で行う）。
--
-- 注意: この列は「どの guild のどのチャンネルか」の親側だけを持つ補助情報であり、帰属(space/org)は
--   従来どおり channel_group_claims の承認で確定する。親IDだけで取り込みを許可してはならない。
-- =============================================================================

alter table public.channel_groups
  add column if not exists external_parent_id text;

comment on column public.channel_groups.external_parent_id is
  '親コンテナの外部ID（Discord guild_id 等）。LINE等の親概念が無いチャネルでは NULL。帰属確定には使わず運用/退出/上限用の補助情報';

-- ロールバック:
--   alter table public.channel_groups drop column if exists external_parent_id;

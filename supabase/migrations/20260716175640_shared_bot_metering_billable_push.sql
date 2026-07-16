-- =============================================================================
-- AI秘書 Stage 4 PR4 メータリング(1/2): 請求対象push を channel_messages 上で識別
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3(使用量メータリング骨格) / §7-10
--
-- 真実の源 = channel_messages（既にorg帰属・全送信経路が通る）から「導出」する。
-- 独立記録経路（別カウンタ表）は作らない（設計正本 §3）。
--
-- LINE は push（pushLineMessage）のみ月間通数(無料枠200/account)を消費し、
-- reply（replyLineMessage）は消費しない。したがって「push 配信された outbound 行」だけを
-- billable_push=true として (org_id, account_id, 月) 集計の唯一の対象にする。
--
-- 加算的・既定 false・RB可（drop column）。inbound 記録・証跡・webhook 200 は一切不変
-- （メータリングの執行は送信境界のみ。DBトリガーでの記録遮断は禁止＝設計正本 §3）。
-- =============================================================================

alter table public.channel_messages
  add column if not exists billable_push boolean not null default false;

comment on column public.channel_messages.billable_push is
  '請求対象push（LINE無料枠を消費する push 配信）なら true。reply配信・inbound は false。'
  '(org_id, account_id, 月) メータリングの唯一の集計対象（設計正本 §3 / §7-10）。';

-- 月次集計（送信境界の quota state を更新する cron の per-org クエリ）を軽くする部分インデックス。
--   where billable_push and org_id = $1 and occurred_at >= $from and occurred_at < $to
-- を org_id 等価 → occurred_at レンジで引く。account_id は末尾（account軸監視の group by 用）。
create index if not exists channel_messages_billable_push_usage
  on public.channel_messages (org_id, occurred_at, account_id)
  where billable_push;

-- =============================================================================
-- 検証（適用後）:
--   1) 既存行はすべて billable_push=false（default）で、集計対象に入らないこと。
--   2) 部分インデックスが billable_push=true 行のみを含むこと。
-- ロールバック:
--   drop index if exists public.channel_messages_billable_push_usage;
--   alter table public.channel_messages drop column if exists billable_push;
-- =============================================================================

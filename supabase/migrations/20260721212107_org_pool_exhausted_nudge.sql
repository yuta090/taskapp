-- =============================================================================
-- org_pool_exhausted_nudge: プールAI(当社鍵)の当月org別原価上限到達通知を
--                           org×月で1回に冪等化するガード
-- 設計正本: 有料プールAI鍵(20260721194655 ai_usage_key_source)の後続。
--   docs/sales/BUNDLE_ECONOMICS.md / src/lib/ai/client.ts getAiConfig
--
-- Pro org が当月の pooled 原価上限(PLATFORM_AI_MONTHLY_CAP_JPY_PER_ORG)に達すると
-- getAiConfig が pool_quota_exhausted を投げ、digest の自動タスク抽出が停止する。
-- これを事務所(内部owner/admin)へ アプリ内通知＋メールで「自社AIキー登録で即時復旧」
-- として届ける。digest は毎日走り抽出のたびに枯渇し得るので、この通知は
-- **org×月で1回だけ** にする必要がある。その先着1件ガードを担う最小テーブル
-- （PKの一意制約で二重実行を弾く）。
--
-- ⚠ これは Pro の内部運用事情。相手先(顧客)グループには一切出さない（LINE push は無い）。
-- =============================================================================

create table if not exists public.org_pool_exhausted_nudge (
  org_id uuid not null references public.organizations(id) on delete cascade,
  month text not null,               -- 'YYYY-MM'（JST基準）
  created_at timestamptz not null default now(),
  primary key (org_id, month)
);

comment on table public.org_pool_exhausted_nudge is
  'プールAI当月上限到達通知の org×月 冪等ガード。行が有れば当月は通知済み（PK一意で先着1件のみ通す）。';

alter table public.org_pool_exhausted_nudge enable row level security;
-- policy は置かない（service role のみ。cron/サーバー側からのみ書く）。

-- =============================================================================
-- ロールバック:
--   drop table if exists public.org_pool_exhausted_nudge;
-- =============================================================================

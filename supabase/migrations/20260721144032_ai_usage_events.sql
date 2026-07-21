-- =============================================================================
-- ai_usage_events: LLM抽出の実トークン使用量 log（COGS＝原価床の実測用テレメトリ）
--
-- 目的: ツール単体では「営業が売るような単価」にならない。よってこの log は売値のためではなく、
--   上位コンサル/multica にバンドルしたときの **粗利を守る原価床** を org 単位・月次で実測するため。
--   1呼び出しごとの prompt/completion トークンを積み、src/lib/ai/cost.ts の単価表で円原価に換算する。
--
-- 書き込みは service role のみ（callLlm の best-effort 記録）。RLS を有効化し policy を置かない
--   ＝ anon/authenticated からは不可視（service role は RLS を bypass）。運用者向け集計は superadmin
--   admin パネル or レポートから service client で読む。
-- =============================================================================

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  purpose text,
  occurred_at timestamptz not null default now()
);

comment on table public.ai_usage_events is
  'LLM抽出の実トークン使用量log。COGS(原価床)の月次実測用テレメトリ。書き込みはservice roleのみ。';
comment on column public.ai_usage_events.purpose is
  '呼び出し用途ラベル（例 digest_extract）。原価をどの機能が食っているかの内訳用。NULL可。';

-- org×期間の集計が主用途。
create index if not exists idx_ai_usage_events_org_occurred
  on public.ai_usage_events (org_id, occurred_at);

alter table public.ai_usage_events enable row level security;
-- policy は置かない（service role のみ）。将来 org 管理者に自組織分を見せるなら別PRで read policy を足す。

-- -----------------------------------------------------------------------------
-- 月次ロールアップ view: org×月×provider×model のトークン合計と件数。
-- 円原価は単価がコード側(cost.ts)にあるためここでは出さず、トークンだけ集計する
--   （DDLに変動価格を焼き込まない）。呼び出し側が MODEL_PRICES で換算する。
-- -----------------------------------------------------------------------------
create or replace view public.app_org_ai_usage_monthly as
select
  org_id,
  date_trunc('month', occurred_at) as month,
  provider,
  model,
  count(*) as call_count,
  sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens
from public.ai_usage_events
group by org_id, date_trunc('month', occurred_at), provider, model;

comment on view public.app_org_ai_usage_monthly is
  'ai_usage_events の org×月×model トークン合計。円原価換算は src/lib/ai/cost.ts の MODEL_PRICES で行う。';

-- =============================================================================
-- ロールバック:
--   drop view if exists public.app_org_ai_usage_monthly;
--   drop table if exists public.ai_usage_events;
-- =============================================================================

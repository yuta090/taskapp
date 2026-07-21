-- =============================================================================
-- ai_usage_events に key_source を追加（BYO鍵 vs プール鍵の原価分別）
-- 設計正本: fable裁定(2026-07-21 プールAI鍵) / docs/sales/BUNDLE_ECONOMICS.md
--
-- 有料(Pro)向けに当社提供のプール鍵を出す。プール分は当社がトークン課金を負うため、
--   org別・月次・円建てのハード上限で執行する。その上限判定は **pooled 利用分のみ** を対象に
--   する必要がある（BYO分を混ぜて数えると、自前鍵で回している org が突然止まる誤爆になる）。
--   そこで使用量logに key_source('byo'|'pooled') を持たせて分別する。
-- =============================================================================

alter table public.ai_usage_events
  add column if not exists key_source text not null default 'byo'
    check (key_source in ('byo', 'pooled'));

comment on column public.ai_usage_events.key_source is
  '鍵の出所: byo(org自前鍵) / pooled(当社提供プール鍵)。pooled分だけがorg別原価上限の対象。';

-- 月次ロールアップ view を key_source 別に集計できるよう作り直す。
-- （key_source 列を途中に挿すため create or replace は列順制約で不可。drop→create で作り直す。
--   このviewに依存するDBオブジェクトは無い＝安全。）
drop view if exists public.app_org_ai_usage_monthly;
create view public.app_org_ai_usage_monthly as
select
  org_id,
  date_trunc('month', occurred_at) as month,
  provider,
  model,
  key_source,
  count(*) as call_count,
  sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens
from public.ai_usage_events
group by org_id, date_trunc('month', occurred_at), provider, model, key_source;

comment on view public.app_org_ai_usage_monthly is
  'ai_usage_events の org×月×model×key_source トークン合計。円原価換算は src/lib/ai/cost.ts の MODEL_PRICES で行う。';

-- -----------------------------------------------------------------------------
-- 当月の pooled 使用量を model 別に返す（org別原価上限の判定に使う）。
-- 円換算はコード側(cost.ts の MODEL_PRICES/estimateCostJpy)で行うため、ここは model 別トークンだけ返す
--   （DDLに変動価格を焼き込まない）。月境界は UTC の date_trunc('month', now())＝安全側の近似で十分。
-- service role(PostgREST) から rpc で呼べるよう grant する。
-- -----------------------------------------------------------------------------
create or replace function public.app_org_pooled_usage_this_month(p_org uuid)
returns table(model text, prompt_tokens bigint, completion_tokens bigint)
language sql
stable
security definer
set search_path = public
as $$
  select model,
         sum(prompt_tokens)::bigint,
         sum(completion_tokens)::bigint
  from public.ai_usage_events
  where org_id = p_org
    and key_source = 'pooled'
    and occurred_at >= date_trunc('month', now())
  group by model
$$;

revoke all on function public.app_org_pooled_usage_this_month(uuid) from public, anon, authenticated;
grant execute on function public.app_org_pooled_usage_this_month(uuid) to service_role;

-- =============================================================================
-- 検証（run_ai_usage_key_source.sh）:
--   key_source 既定 'byo' / 'pooled' 挿入可 / 不正値は check で拒否。
--   view が key_source 別に分割集計する。
--   app_org_pooled_usage_this_month が当月 pooled 分のみ(byoと先月を除外)を model 別に合算する。
-- ロールバック:
--   drop function if exists public.app_org_pooled_usage_this_month(uuid);
--   -- view を key_source 無し版へ戻す（20260721144032 の定義）。
--   alter table public.ai_usage_events drop column if exists key_source;
-- =============================================================================

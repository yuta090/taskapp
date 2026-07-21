import { createAdminClient } from '@/lib/supabase/admin'
import { estimateCostJpy } from '@/lib/ai/cost'

export type AiKeySource = 'byo' | 'pooled'

export interface RecordAiUsageParams {
  orgId: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  /** 呼び出し用途ラベル（例 'digest_extract'）。原価の内訳用。 */
  purpose?: string
  /** 鍵の出所。プールAI(当社鍵)の原価上限判定で byo と分別するため。既定 'byo'。 */
  keySource?: AiKeySource
}

/**
 * AI呼び出しのトークン使用量を ai_usage_events に best-effort で記録する（COGS実測テレメトリ）。
 *
 * 最重要: 抽出本体の成否には絶対に影響させない。記録失敗（DBエラー・service key 不在・ネットワーク）は
 * すべて握りつぶす。売値ではなく粗利の原価床を可視化するための log なので、欠損しても実害は集計精度だけ。
 */
export async function recordAiUsage(params: RecordAiUsageParams): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('ai_usage_events').insert({
      org_id: params.orgId,
      provider: params.provider,
      model: params.model,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      purpose: params.purpose ?? null,
      key_source: params.keySource ?? 'byo',
    })
  } catch {
    // best-effort: テレメトリ記録の失敗で本処理を壊さない
  }
}

/**
 * 当月の「プール鍵(pooled)」利用の円原価を積み上げて返す（org別月次ハード上限の判定用）。
 *
 * best-effort ではない: 呼び出し側（getAiConfig のプール分岐）が cap 判定に使う。ただし呼び出し側は
 * この関数が throw したら **fail-open**（テレメトリDB不調で全Pro orgの抽出を止めない）方針で扱う。
 * BYO 分は対象外（app_org_pooled_usage_this_month が key_source='pooled' だけを返す）。
 * 未知モデル（MODEL_PRICES 未収録）は estimateCostJpy が null を返すため加算しない
 *   （プールmodelは MODEL_PRICES に必ず存在する制約をテストで固定しているので実運用では起きない）。
 */
export async function getOrgPooledCostJpyThisMonth(orgId: string): Promise<number> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('app_org_pooled_usage_this_month', { p_org: orgId })
  if (error) {
    throw new Error(`app_org_pooled_usage_this_month failed: ${error.message}`)
  }
  const rows = (data ?? []) as Array<{
    model: string
    prompt_tokens: number | string
    completion_tokens: number | string
  }>
  let totalJpy = 0
  for (const r of rows) {
    const jpy = estimateCostJpy(r.model, {
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
    })
    if (jpy != null) totalJpy += jpy
  }
  return totalJpy
}

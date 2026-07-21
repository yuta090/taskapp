import { createAdminClient } from '@/lib/supabase/admin'

export interface RecordAiUsageParams {
  orgId: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  /** 呼び出し用途ラベル（例 'digest_extract'）。原価の内訳用。 */
  purpose?: string
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
    })
  } catch {
    // best-effort: テレメトリ記録の失敗で本処理を壊さない
  }
}

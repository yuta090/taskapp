/**
 * AI抽出の原価(COGS)見積り。
 *
 * 目的（重要）: ツール単体では「営業が売るような単価」にはならない。よってこの原価は
 * *売値* を出すためのものではなく、上位のコンサル/multica にバンドルしたときの
 * **粗利を守る原価床(floor)** を把握するためのもの。1メッセージ/1ダイジェスト当たりの
 * 実トークンから、org 単位・月次の LLM 原価を積み上げて可視化する（docs/sales/BUNDLE_ECONOMICS.md）。
 *
 * トークン単価は各社の公開価格(per 1M tokens, USD)。価格は変動するため、ここは初期見積り値で
 * あり、実測（ai_usage_events の実トークン集計）で継続的に上書きする前提。
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface ModelPrice {
  /** 入力トークン単価（USD / 1M tokens） */
  inputPerMTokUsd: number
  /** 出力トークン単価（USD / 1M tokens） */
  outputPerMTokUsd: number
}

/**
 * 代表的モデルの単価（2026-01 時点の公開価格の代表値・USD/1M tok）。
 * ⚠ 確定値ではない。実測と各社の最新価格で更新すること。未収録モデルは estimateCost が null を返す
 *   （0円扱いにして原価を過小評価しないため）。
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o-mini': { inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 },
  'gpt-4o': { inputPerMTokUsd: 2.5, outputPerMTokUsd: 10.0 },
  'gpt-4.1-mini': { inputPerMTokUsd: 0.4, outputPerMTokUsd: 1.6 },
  'gpt-4.1': { inputPerMTokUsd: 2.0, outputPerMTokUsd: 8.0 },
  // Anthropic
  'claude-haiku-4-5': { inputPerMTokUsd: 1.0, outputPerMTokUsd: 5.0 },
  'claude-sonnet-4-5': { inputPerMTokUsd: 3.0, outputPerMTokUsd: 15.0 },
  'claude-3-5-haiku': { inputPerMTokUsd: 0.8, outputPerMTokUsd: 4.0 },
  'claude-3-5-sonnet': { inputPerMTokUsd: 3.0, outputPerMTokUsd: 15.0 },
}

/** 円換算の既定為替（USD/JPY）。安全側にやや高めの想定。実測レポートでは実勢に置換する。 */
export const DEFAULT_USD_JPY = 160

/** モデルIDのゆれ（末尾の日付や `[1m]` 等）を吸収して価格表キーに正規化する。 */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .replace(/\[[^\]]*\]$/, '') // 末尾の [1m] 等
    .replace(/-\d{6,8}$/, '') // 末尾の -YYYYMMDD / -YYYYMM
    .replace(/-latest$/, '')
}

/** 既知モデルなら USD 原価、未知モデルは null。 */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[model] ?? MODEL_PRICES[normalizeModelId(model)]
  if (!price) return null
  return (
    (usage.promptTokens / 1_000_000) * price.inputPerMTokUsd +
    (usage.completionTokens / 1_000_000) * price.outputPerMTokUsd
  )
}

/** 既知モデルなら円原価、未知モデルは null。 */
export function estimateCostJpy(
  model: string,
  usage: TokenUsage,
  usdJpy: number = DEFAULT_USD_JPY,
): number | null {
  const usd = estimateCostUsd(model, usage)
  return usd == null ? null : usd * usdJpy
}

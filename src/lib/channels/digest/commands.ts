/**
 * グループ内「完了N」「N 完了」テキストの解析。
 * 最新digestの digest_number=N を消し込むための突合に使う。
 * マッチしなければ null（通常メッセージとして記録のみ・誤爆防止のため厳格に判定する）。
 */
export function parseDigestCompleteCommand(text: string): number | null {
  const compact = text
    .trim()
    // 空白（全角スペース含む）は全て除去
    .replace(/[\s　]+/g, '')
    // 全角数字 → 半角
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))

  const prefixMatch = compact.match(/^完了([0-9]+)$/)
  if (prefixMatch) return parseInt(prefixMatch[1], 10)

  const suffixMatch = compact.match(/^([0-9]+)完了$/)
  if (suffixMatch) return parseInt(suffixMatch[1], 10)

  return null
}

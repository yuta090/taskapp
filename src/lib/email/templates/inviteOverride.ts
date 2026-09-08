/**
 * 招待フォームでの「その場編集」用の純粋モジュール。
 *
 * 招待画面では、いま使われている文面（事務所の保存 → 運営の保存 → コード既定 の順で決まる）を
 * そのまま出して編集できる。編集は既定ではその1通かぎりで、「テンプレートとして保存する」に
 * チェックしたときだけ事務所の文面として保存される（保存経路は API 側）。
 *
 * ここには DB も送信も持ち込まない。差し替えと検証だけを扱う。
 * ※ client bundle からも import されるので server 専用モジュールを入れないこと。
 */
import {
  TEMPLATE_FIELD_KEYS,
  validateTemplateFields,
  type TemplateFields,
  type ValidateResult,
} from './core'

/**
 * いまの文面に、送り手が触った項目だけを重ねる。
 * 文字列でない値・知らないキーは無視する（画面から来る値をそのまま信用しないため）。
 * 空文字は「消した」として扱う（補足を空にできる）。
 */
export function mergeTemplateOverride(base: TemplateFields, override: unknown): TemplateFields {
  const merged: TemplateFields = { ...base }
  if (!override || typeof override !== 'object') return merged
  const src = override as Record<string, unknown>
  for (const key of TEMPLATE_FIELD_KEYS) {
    const value = src[key]
    if (typeof value === 'string') merged[key] = value
  }
  return merged
}

/** 差し替えた結果を、通常のテンプレートと同じ物差し（必須・長さ・差し込み語）で検証する */
export function validateTemplateOverride(
  base: TemplateFields,
  override: unknown,
  allowedPlaceholderNames: readonly string[],
): ValidateResult {
  return validateTemplateFields(mergeTemplateOverride(base, override), allowedPlaceholderNames)
}

/**
 * 送り手が文面に手を入れたか。
 * 前後の余白だけの違いは、保存側の trim で消えるので編集とみなさない。
 */
export function isTemplateEdited(base: TemplateFields, draft: TemplateFields): boolean {
  return TEMPLATE_FIELD_KEYS.some((key) => draft[key].trim() !== base[key].trim())
}

/**
 * DB のエラーコードから、次にできることが分かる短い日本語のヒントを返す。
 * 重複・必須項目の不足・つながりの不整合の3種類だけを扱い、それ以外
 * （見覚えのない理由）は中身を隠す（2026-07 のエラー詳細漏洩対策を崩さない）。
 * ヒントは呼んだ人（CLI 経由も含む）にそのまま届けてよい決まった文言なので、
 * ToolUserError として返す（/api/tools が独自のエラーだけを 500 に潰さず、
 * このステータスのまま返す決まりのため）。
 */
import { ToolUserError } from '../errors.js'

interface HintEntry {
  message: string
  status: 400 | 409
}

const PG_ERROR_HINTS: Record<string, HintEntry> = {
  '23505': { message: 'すでに登録されています（重複しています）', status: 409 },
  '23502': { message: '必須の項目が指定されていません', status: 400 },
  '23503': { message: '指定したIDが正しくないか、関連する行が見つかりません', status: 400 },
}

interface DbError {
  code?: string
  message?: string
}

export function dbErrorHint(error: DbError): string | null {
  return PG_ERROR_HINTS[error.code ?? '']?.message ?? null
}

/**
 * DBが断った理由の中身をサーバーの記録にだけ残し、次にできることが分かる
 * ヒント（重複・必須項目の不足・つながりの不整合）があればそれを ToolUserError で、
 * 無ければ中身を隠した一般の Error（fallbackMessage）を返す。
 */
export function hideDbErrorWithHint(error: DbError, context: string, fallbackMessage: string): Error {
  console.error(`${context} failed:`, error.code, error.message)
  const hint = PG_ERROR_HINTS[error.code ?? '']
  if (hint) return new ToolUserError(hint.message, hint.status)
  return new Error(fallbackMessage)
}

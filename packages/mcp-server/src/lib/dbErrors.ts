/**
 * DB が断った理由を、呼んだ人に見せてよい形にする共通の道具。
 * 詳しい内容はサーバーの記録だけに残し、呼んだ人には決まった短い日本語を返す
 * （2026-07 のエラー詳細漏洩対策を崩さない）。
 */
import { ToolUserError } from '../errors.js'

interface DbError {
  code?: string
  message?: string
}

/**
 * `.single()` が0件（PGRST116）で断ったときだけ、見つからない旨のToolUserError(404)にする。
 * それ以外の理由は、中身をサーバーの記録にだけ残し、一般のエラーのまま返す。
 */
export function notFoundOr(error: DbError, context: string, notFoundMessage: string, fallbackMessage: string): Error {
  if (error.code === 'PGRST116') return new ToolUserError(notFoundMessage, 404)
  return hideDbError(error, context, fallbackMessage)
}

/** DBの理由の中身をサーバーの記録にだけ残し、一般のエラーのまま返す。 */
export function hideDbError(error: DbError, context: string, fallbackMessage: string): Error {
  console.error(`${context} failed:`, error.code, error.message)
  return new Error(fallbackMessage)
}

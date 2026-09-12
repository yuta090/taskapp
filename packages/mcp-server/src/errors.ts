/**
 * 呼んだ人に理由をそのまま見せてよいエラー。
 * 文言は決まったもので、秘密（DB の中身・内部の値）を含まないこと。HTTP API（/api/tools）はこの status で返す。
 * それ以外の例外は中身を隠した 500 のまま（2026-07 のエラー詳細漏洩対策を崩さない）。
 */
export class ToolUserError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
    super(message)
    this.name = 'ToolUserError'
    this.status = status
  }
}

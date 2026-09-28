/**
 * 呼んだ人に理由をそのまま見せてよいエラー。
 * 文言は決まったもので、秘密（DB の中身・内部の値）を含まないこと。HTTP API（/api/tools）はこの status で返す。
 * それ以外の例外は中身を隠した 500 のまま（2026-07 のエラー詳細漏洩対策を崩さない）。
 *
 * cause には「なぜ断ったか」の元（DBの生のエラー等）を持たせられる。呼んだ人には返らず、
 * /api/tools・/api/mcp の利用記録（cli_usage_logs.error_detail・運営画面専用）にだけ使う。
 */
export class ToolUserError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(message: string, status: 400 | 403 | 404 | 409 = 400, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ToolUserError'
    this.status = status
  }
}

import { createAdminClient } from '@/lib/supabase/admin'
import { describeError } from './describeError'

/** dispatchTool / dispatchToolWithContext がこの呼び出しで認証した鍵・組織・利用者と、実際に使われた spaceId */
export interface ToolAuthInfo {
  keyId: string
  orgId: string
  userId: string | null
  spaceId: string | null
}

/** どの口から来た呼び出しか。cli=ターミナルのagentpmコマンド(/api/tools), mcp=外部チャットのリモートMCP(/api/mcp) */
export type ToolUsageSource = 'cli' | 'mcp'

/** 呼んだ人にそのまま返してよい決まったエラー。stack を残さない（詳細は cause 側に十分ある） */
function isUserFacingError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ToolUserError'
}

/**
 * Fire-and-forget: ツール呼び出しの利用記録を cli_usage_logs に1行書く。
 * 失敗時は error_message（呼んだ人に返した決まった文言）に加え、error_detail に原因の
 * 詳細（DBのコード・cause チェーン・想定外なら stack）を残す。運営画面(/admin/cli-usage)
 * だけがこれを見られ、呼んだ人には従来どおり error_message の文言しか返さない
 * （2026-07 のエラー詳細漏洩対策はそのまま）。
 *
 * /api/tools・/api/mcp の両方から使う。この呼び出し自身が認証した info をそのまま使い、
 * 共有の config モジュールは読み直さない（複数のリクエストが同時に処理されうるため）。
 */
export function logToolUsage(params: {
  toolName: string
  status: 'success' | 'error'
  responseMs: number
  info: ToolAuthInfo | null
  source: ToolUsageSource
  error?: unknown
}): void {
  const { toolName, status, responseMs, info, source, error } = params
  if (!info) return // 認証前に失敗した等、記録すべき鍵・組織が確定していない

  try {
    const admin = createAdminClient()
    const errorMessage = status === 'error' ? (error instanceof Error ? error.message : String(error)) : null
    const errorDetail =
      status === 'error' ? describeError(error, { includeStack: !isUserFacingError(error) }) : null

    admin
      .from('cli_usage_logs')
      .insert({
        api_key_id: info.keyId === 'dev-key' ? null : info.keyId,
        org_id: info.orgId,
        space_id: info.spaceId,
        user_id: info.userId,
        tool_name: toolName,
        status,
        error_message: errorMessage,
        error_detail: errorDetail,
        response_ms: responseMs,
        source,
      })
      .then(({ error: insertError }: { error: { message: string } | null }) => {
        if (insertError) console.error('cli_usage_logs insert failed:', insertError.message)
      })
  } catch {
    // 応答を止めない
  }
}

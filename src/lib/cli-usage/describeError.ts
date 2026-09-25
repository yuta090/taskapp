/**
 * ツール呼び出しが失敗したときの原因を、cli_usage_logs.error_detail（運営画面専用）に
 * 残せる JSON に変換する。呼んだ人（CLI / 外部チャット）にはこの中身を一切返さない
 * （2026-07 のエラー詳細漏洩対策を崩さない。返すのは従来どおり決まった error_message だけ）。
 *
 * 想定外の入力（文字列・null・循環参照のある cause）でも例外を投げない。
 */

const MAX_STRING_LENGTH = 1000
const MAX_CAUSE_DEPTH = 3
const MAX_STACK_LINES = 5

/** 既知の DB エラー（PostgREST/supabase-js）が持つキーだけを拾う */
const CAUSE_KEYS = ['name', 'code', 'message', 'details', 'hint'] as const

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value
}

/** cause チェーンの1段を、JSON に残せる素の値にする。拾えるものが無ければ undefined */
function describeCauseLevel(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined
  if (value instanceof Error) {
    return { name: value.name, message: truncate(value.message) }
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of CAUSE_KEYS) {
      const v = source[key]
      if (typeof v === 'string') out[key] = truncate(v)
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  if (typeof value === 'string') return { message: truncate(value) }
  return undefined
}

/** 次にたどるべき cause（Error なら .cause、それ以外はもう先が無い） */
function nextCause(value: unknown): unknown {
  return value instanceof Error ? (value as Error & { cause?: unknown }).cause : undefined
}

export interface DescribeErrorOptions {
  /** 想定外(500)のときだけ true。ToolUserError 等の「見せてよい」エラーでは付けない */
  includeStack?: boolean
}

export function describeError(error: unknown, options?: DescribeErrorOptions): Record<string, unknown> | null {
  try {
    if (error === null || error === undefined) return null

    if (!(error instanceof Error)) {
      // 文字列・数値などをそのまま投げているツールもある。落とさず message として残す
      return { message: truncate(String(error)) }
    }

    const result: Record<string, unknown> = { name: error.name, message: truncate(error.message) }

    const status = (error as Error & { status?: unknown }).status
    if (typeof status === 'number') result.status = status

    if (options?.includeStack && typeof error.stack === 'string') {
      result.stack = error.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n')
    }

    // cause チェーンを最大3段たどる。循環していても訪問済みで止める
    const seen = new Set<unknown>([error])
    let target = result
    let current = nextCause(error)
    for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth++) {
      if (seen.has(current)) break
      seen.add(current)
      const described = describeCauseLevel(current)
      if (!described) break
      target.cause = described
      target = described
      current = nextCause(current)
    }

    return result
  } catch {
    // ここで落ちて記録自体が失敗すると本末転倒。何が起きても null を返す
    return null
  }
}

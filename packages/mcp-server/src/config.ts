import { AsyncLocalStorage } from 'node:async_hooks'
import { config as dotenvConfig } from 'dotenv'
import type { AuthContext, ActionType, Channel } from './auth/authorize.js'
import { createAuthContext } from './auth/authorize.js'
import { getSupabaseClient } from './supabase/client.js'
import { AUTH_REASON_LABELS } from './lib/authReasonLabels.js'

dotenvConfig()

export interface McpServerConfig {
  supabaseUrl: string
  supabaseServiceKey: string
  /** stdio モードの既定プロジェクト（TASKAPP_SPACE_ID）。HTTP では使わない */
  spaceId: string
}

function getEnvWithFallback(primary: string, fallback: string): string {
  return process.env[primary] || process.env[fallback] || ''
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue
}

function parseAllowedActions(value: string | undefined): ActionType[] {
  if (!value) return ['read']
  return value.split(',').map(a => a.trim()) as ActionType[]
}

export function loadConfig(): McpServerConfig {
  return {
    supabaseUrl: getEnvWithFallback('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    supabaseServiceKey: getEnvWithFallback('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    spaceId: getEnvOrDefault('TASKAPP_SPACE_ID', '00000000-0000-0000-0000-000000000010'),
  }
}

export const config = loadConfig()

// =============================================================================
// 認証コンテキスト（リクエストごとに分離する）
// =============================================================================

/**
 * ⚠ テナント分離の要。
 *
 * 以前は認証コンテキストをこのモジュールの可変な変数に置き、dispatch 側で全リクエストを
 * 直列化して混線を避けていた。HTTP の受け口（/api/mcp・/api/tools）は複数の利用者が同時に
 * 叩くため、その作りでは「1人の遅い呼び出しが全員を待たせる」か「直列化を外した瞬間に
 * 別の組織のデータが見える」かのどちらかになる。
 *
 * そこで AsyncLocalStorage に移す。await をまたいでも、その呼び出し自身のコンテキストが
 * 追随する。ツール側のコードは getAuthContext() / getActorId() を呼ぶだけでよい。
 *
 * fail-closed: ストアが無ければ「誰でもない」ではなく **例外で止める**。
 * 以前あった「開発用デフォルトの全権限コンテキスト」は、本番で認証漏れを黙って通す穴に
 * なるため復活させないこと。
 */
const authStore = new AsyncLocalStorage<AuthContext>()

/**
 * プロセス全体のコンテキスト。stdio モード（1プロセス＝1利用者）でのみ設定する。
 * HTTP では決して設定しない（設定するとリクエスト間で漏れる）。
 */
let processAuthContext: AuthContext | null = null

/** この呼び出しのあいだだけ ctx を有効にしてツールを実行する。ツール実行の唯一の入口 */
export function runWithAuthContext<T>(ctx: AuthContext, fn: () => Promise<T>): Promise<T> {
  return authStore.run(ctx, fn)
}

/**
 * 認証コンテキストを取得。
 * リクエストのストア → stdio のプロセス全体 の順に見て、どちらも無ければ例外。
 */
export function getAuthContext(): AuthContext {
  const ctx = getAuthContextOrNull()
  if (ctx) return ctx
  throw new Error(AUTH_REASON_LABELS.noAuthContext)
}

/**
 * getAuthContext() の例外を投げない版。
 * supabase/client.ts の getSupabaseClient() が「今の呼び出しに紐づく ctx があれば、
 * その ctx 向けのクライアントを返す。無ければ（スクリプト等）共有のシングルトンを返す」
 * を選ぶために使う。ツール本体は引き続き getAuthContext()（無ければ即例外）を使うこと。
 */
export function getAuthContextOrNull(): AuthContext | null {
  const fromRequest = authStore.getStore()
  if (fromRequest) return fromRequest
  if (processAuthContext) return processAuthContext
  return null
}

// =============================================================================
// APIキーの検証
// =============================================================================

/**
 * API キーを検証して認証コンテキストを作って返す（グローバルは書き換えない）。
 * 呼び出し元が runWithAuthContext に渡す。
 */
export async function resolveAuthContext(apiKey: string, channel: Channel = 'cli'): Promise<AuthContext> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('rpc_validate_api_key', { p_api_key: apiKey })

  if (error || !data || (data as Record<string, unknown>[]).length === 0) {
    throw new Error(AUTH_REASON_LABELS.invalidOrExpiredApiKey)
  }

  const row = (data as Record<string, unknown>[])[0]

  return createAuthContext(
    {
      key_id: row.key_id as string,
      user_id: (row.user_id as string) || null,
      org_id: row.org_id as string,
      scope: row.scope as string,
      allowed_space_ids: (row.allowed_space_ids as string[]) || null,
      allowed_actions: (row.allowed_actions as string[]) || ['read'],
      space_id: (row.space_id as string) || null,
    },
    channel,
  )
}

/**
 * OAuth の合鍵（の控え）から認証コンテキストを作る。
 *
 * 生のAPIキーを見る rpc_validate_api_key と別の関数にしてあるので、OAuth の合鍵は
 * /api/mcp でしか通らない（CLI 用の /api/tools は生のAPIキーしか受け付けない）。
 */
export async function resolveAuthContextFromOAuthToken(
  tokenHash: string,
  channel: Channel = 'mcp',
): Promise<AuthContext> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('rpc_validate_oauth_token', { p_token_hash: tokenHash })

  if (error || !data || (data as Record<string, unknown>[]).length === 0) {
    throw new Error(AUTH_REASON_LABELS.invalidOrExpiredApiKey)
  }

  const row = (data as Record<string, unknown>[])[0]

  return createAuthContext(
    {
      key_id: row.key_id as string,
      user_id: (row.user_id as string) || null,
      org_id: row.org_id as string,
      scope: row.scope as string,
      allowed_space_ids: (row.allowed_space_ids as string[]) || null,
      allowed_actions: (row.allowed_actions as string[]) || ['read'],
      space_id: (row.space_id as string) || null,
    },
    channel,
  )
}

/**
 * stdio サーバーの起動時に1回だけ呼ぶ。プロセス全体のコンテキストを決める。
 * HTTP からは呼ばないこと（resolveAuthContext + runWithAuthContext を使う）。
 */
export async function initializeAuth(): Promise<void> {
  const apiKey = process.env.TASKAPP_API_KEY
  if (!apiKey) {
    console.error('FATAL: TASKAPP_API_KEY is required')
    process.exit(1)
  }

  try {
    processAuthContext = await resolveAuthContext(apiKey, 'stdio')
  } catch (e) {
    console.error('FATAL: API key validation failed:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  if (config.spaceId && !processAuthContext.spaceId) {
    processAuthContext = { ...processAuthContext, spaceId: config.spaceId }
  }

  console.error(`Auth initialized: scope=${processAuthContext.scope}, org=${processAuthContext.orgId}`)
}

/** テスト専用。プロセス全体のコンテキストを差し替える */
export function __setProcessAuthContextForTest(ctx: AuthContext | null): void {
  processAuthContext = ctx
}

export type { AuthContext, ActionType, Channel }
export { parseAllowedActions }

import { config as dotenvConfig } from 'dotenv'
import type { AuthContext, ActionType } from './auth/authorize.js'
import { createAuthContext } from './auth/authorize.js'
import { getSupabaseClient } from './supabase/client.js'

dotenvConfig()

export interface McpServerConfig {
  supabaseUrl: string
  supabaseServiceKey: string
  // 従来の固定値（後方互換性のため維持）
  orgId: string
  spaceId: string
  actorId: string
  // 新しい認証コンテキスト（APIキーから取得）
  authContext: AuthContext | null
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue
}

function parseAllowedActions(value: string | undefined): ActionType[] {
  if (!value) return ['read']
  return value.split(',').map(a => a.trim()) as ActionType[]
}

export function loadConfig(): McpServerConfig {
  // APIキーが環境変数で設定されている場合は認証コンテキストを作成
  const apiKeyId = process.env.TASKAPP_API_KEY_ID
  const apiKeyUserId = process.env.TASKAPP_API_KEY_USER_ID
  const apiKeyScope = process.env.TASKAPP_API_KEY_SCOPE as 'space' | 'org' | 'user' | undefined
  const apiKeyAllowedSpaceIds = process.env.TASKAPP_API_KEY_ALLOWED_SPACE_IDS
  const apiKeyAllowedActions = process.env.TASKAPP_API_KEY_ALLOWED_ACTIONS

  let authContext: AuthContext | null = null
  if (apiKeyId) {
    authContext = {
      keyId: apiKeyId,
      userId: apiKeyUserId || null,
      orgId: getEnvOrDefault('TASKAPP_ORG_ID', '00000000-0000-0000-0000-000000000001'),
      scope: apiKeyScope || 'space',
      allowedSpaceIds: apiKeyAllowedSpaceIds ? apiKeyAllowedSpaceIds.split(',') : null,
      allowedActions: parseAllowedActions(apiKeyAllowedActions),
    }
  }

  return {
    supabaseUrl: getEnvOrThrow('SUPABASE_URL'),
    supabaseServiceKey: getEnvOrThrow('SUPABASE_SERVICE_KEY'),
    orgId: getEnvOrDefault('TASKAPP_ORG_ID', '00000000-0000-0000-0000-000000000001'),
    spaceId: getEnvOrDefault('TASKAPP_SPACE_ID', '00000000-0000-0000-0000-000000000010'),
    actorId: getEnvOrDefault('TASKAPP_ACTOR_ID', '00000000-0000-0000-0000-000000000099'),
    authContext,
  }
}

export const config = loadConfig()

/**
 * ランタイムAPIキー検証
 * TASKAPP_API_KEY が設定されている場合、DB側の rpc_validate_api_key で検証し
 * 認証コンテキストを動的に設定する
 */
export async function initializeAuth(): Promise<void> {
  const apiKey = process.env.TASKAPP_API_KEY
  if (!apiKey) {
    console.error('WARNING: TASKAPP_API_KEY not set, using static config (dev mode)')
    return
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('rpc_validate_api_key', { p_api_key: apiKey })

  if (error || !data || (data as Record<string, unknown>[]).length === 0) {
    console.error('FATAL: API key validation failed:', error?.message || 'key not found/expired')
    process.exit(1)
  }

  const row = (data as Record<string, unknown>[])[0]

  config.authContext = createAuthContext({
    key_id: row.key_id as string,
    user_id: (row.user_id as string) || null,
    org_id: row.org_id as string,
    scope: row.scope as string,
    allowed_space_ids: (row.allowed_space_ids as string[]) || null,
    allowed_actions: (row.allowed_actions as string[]) || ['read'],
  })
  config.orgId = row.org_id as string
  if (row.space_id) config.spaceId = row.space_id as string
  if (row.user_id) config.actorId = row.user_id as string

  console.error(`Auth initialized: scope=${row.scope}, org=${row.org_id}`)
}

/**
 * 認証コンテキストを取得
 * 設定されていない場合はデフォルトの全権限コンテキストを返す（開発用）
 */
export function getAuthContext(): AuthContext {
  if (config.authContext) {
    return config.authContext
  }

  // 開発用デフォルト（全権限）
  console.error('WARNING: No auth context configured, using default (full access)')
  return {
    keyId: 'dev-key',
    userId: config.actorId,
    orgId: config.orgId,
    scope: 'space',
    allowedSpaceIds: null,
    allowedActions: ['read', 'write', 'delete', 'bulk'],
  }
}

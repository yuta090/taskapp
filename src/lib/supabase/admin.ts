import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * change_log トリガー（誰が・どの経路で書いたか。supabase 側 PR #1027）向けの送信元区分。
 * DB 側が x-agentpm-channel ヘッダーを信用するのはこの並びだけ
 * （packages/mcp-server/src/auth/authorize.ts の Channel と同じ並びを保つこと）。
 */
export type Channel =
  | 'app'
  | 'cli'
  | 'mcp'
  | 'stdio'
  | 'portal'
  | 'cron'
  | 'webhook'
  | 'connector'
  | 'admin'
  | 'system'

export interface AdminClientAttribution {
  channel: Channel
  /** 実際に操作した人（分かるときだけ）。tasks.assignee_id 等と同じ auth.users.id */
  actorUserId?: string | null
  /** CLI/MCP の API キー（分かるときだけ）。'dev-key' 等の開発用の目印は UUID でないため自動で落ちる */
  apiKeyId?: string | null
  /** 1回の呼び出しをまたいで揃えたいときだけ渡す。省略時は呼び出しごとに新しく作る */
  requestId?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidish(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * change_log トリガー向けのヘッダーを組み立てる。**使うのは引数として明示的に渡された
 * 値だけ**。受け取ったリクエストのヘッダー（x-agentpm-*）をそのまま転送するコードを
 * ここに足さないこと — 外から任意の actor-id/channel を名乗れる、なりすましの入口になる。
 */
function buildAttributionHeaders(attribution: AdminClientAttribution): Record<string, string> {
  const headers: Record<string, string> = {
    'x-agentpm-channel': attribution.channel,
    'x-agentpm-request-id': attribution.requestId || randomUUID(),
  }
  if (isUuidish(attribution.actorUserId)) headers['x-agentpm-actor-id'] = attribution.actorUserId
  if (isUuidish(attribution.apiKeyId)) headers['x-agentpm-api-key-id'] = attribution.apiKeyId
  return headers
}

/**
 * Create Supabase admin client with service_role key (bypasses RLS).
 * Server-side only — never import in 'use client' components.
 *
 * attribution を渡すと、change_log トリガー（誰が・どの経路で書いたか）が読む
 * x-agentpm-* ヘッダーを付ける。省略すると従来どおりヘッダー無し（channel='unattributed'
 * としてDBに記録される）。既存の呼び出しを壊さないため、この引数は任意。
 */
export function createAdminClient(attribution?: AdminClientAttribution) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration for admin client')
  }

  return createSupabaseAdmin(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(attribution ? { global: { headers: buildAttributionHeaders(attribution) } } : {}),
  })
}

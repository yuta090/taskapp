// server-side only（service role を使う）。'use client' から import しない。
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp } from '@/lib/rate-limit'

/**
 * ログイン（OAuth コールバック）失敗の記録。auth_event_logs へ best-effort で1行入れる。
 *
 * - 絶対に throw しない（記録の失敗でログイン動線を止めない）
 * - service role で書く（RLS: policy 無し＝anon/authenticated 不可視）
 * - stage の値は supabase/migrations/*_auth_event_logs.sql のコメントと一致させる
 */
export type AuthEventStage =
  | 'provider_callback'
  | 'missing_code'
  | 'code_exchange'
  | 'session_user'
  | 'landing'
  // 二要素認証の解除（運営による復旧操作。成功も拒否も残す）
  | 'mfa_reset'
  | 'mfa_reset_denied'

export interface AuthFailureInput {
  stage: AuthEventStage
  provider?: string
  errorCode?: string | null
  errorDescription?: string | null
  userId?: string | null
  email?: string | null
  request?: Request
  metadata?: Record<string, unknown>
}

const DESCRIPTION_MAX = 1000
const USER_AGENT_MAX = 256

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  return value.length > max ? value.slice(0, max) : value
}

/** 認証まわりのセキュリティイベント全般（失敗に限らない）。recordAuthFailure と同じ経路 */
export const recordAuthEvent = recordAuthFailure

export async function recordAuthFailure(input: AuthFailureInput): Promise<void> {
  try {
    const request = input.request
    const ip = request ? getClientIp(request) : null
    const userAgent = request ? clip(request.headers.get('user-agent'), USER_AGENT_MAX) : null

    const admin = createAdminClient()
    const { error } = await admin.from('auth_event_logs').insert({
      stage: input.stage,
      provider: input.provider ?? 'google',
      error_code: input.errorCode ?? null,
      error_description: clip(input.errorDescription, DESCRIPTION_MAX),
      user_id: input.userId ?? null,
      email: input.email ?? null,
      ip: ip && ip !== 'unknown' ? ip : null,
      user_agent: userAgent,
      metadata: input.metadata ?? null,
    })
    if (error) {
      console.error('[auth_event_logs] insert failed:', error.message)
    }
  } catch (err) {
    console.error('[auth_event_logs] record failed:', err instanceof Error ? err.message : err)
  }
}

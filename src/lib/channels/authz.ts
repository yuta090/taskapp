import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createClient } from '@/lib/supabase/server'
import { createRouteAuth } from '@/lib/supabase/routeAuth'

/**
 * チャネル配管APIの認可: org内部メンバー(owner/admin/member)のみ。
 * クライアント/ベンダーは不可（秘書の会話ログ・突合コードは内部専用）。
 * bot有効/無効の切替等、破壊的な操作は requireOrgAdmin（owner/adminのみ）を使う。
 *
 * スマホアプリ（Authorization: Bearer）を受け付けるのは、**第2引数に request を渡したルートだけ**。
 * 渡さないルートは今までどおり Cookie のログインだけ（このファイルを使う全ルートに効かせない）。
 * Bearer のときは、権限判定（所属と役割）は Cookie と同じで、さらに二要素認証の確認（mfaGuardResponse）を行う。
 * Authorization が Bearer でない（無い・Basic など）リクエストは Cookie で確かめる。
 */

export type InternalRole = 'owner' | 'admin' | 'member'

export type InternalAuthResult =
  | { ok: true; userId: string; role: InternalRole }
  | { ok: false; status: 401 | 403; error: string }

const INTERNAL_ROLES = new Set<string>(['owner', 'admin', 'member'])
const ADMIN_ROLES = new Set<string>(['owner', 'admin'])

type MembershipResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 403; error: 'no membership' | 'mfa_required' }

const BEARER_HEADER_RE = /^Bearer(\s|$)/i

async function resolveMembership(orgId: string, request?: NextRequest): Promise<MembershipResult> {
  let supabase: SupabaseClient
  let userId: string

  if (request && BEARER_HEADER_RE.test(request.headers.get('authorization') ?? '')) {
    // 無効なトークンは Cookie に戻さず 401（取り違えない）
    const auth = await createRouteAuth(request)
    if (!auth) return { ok: false, status: 401, error: 'Unauthorized' }
    // service role で触る前に、登録済み × コード未入力(aal1) を弾く。トークンを必ず渡す
    const mfaBlock = await mfaGuardResponse(auth.supabase as SupabaseClient, auth.user, auth.accessToken)
    if (mfaBlock) return { ok: false, status: 403, error: 'mfa_required' }
    supabase = auth.supabase as SupabaseClient
    userId = auth.user.id
  } else {
    const cookieClient = await createClient()
    const {
      data: { user },
      error,
    } = await cookieClient.auth.getUser()
    if (error || !user) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    supabase = cookieClient as SupabaseClient
    userId = user.id
  }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single()

  if (!membership) {
    return { ok: false, status: 403, error: 'no membership' }
  }

  return { ok: true, userId, role: membership.role as string }
}

export async function requireInternalMember(orgId: string, request?: NextRequest): Promise<InternalAuthResult> {
  const result = await resolveMembership(orgId, request)
  if (!result.ok) {
    if (result.status === 401 || result.error === 'mfa_required') return result
    return { ok: false, status: 403, error: 'Internal members only' }
  }
  if (!INTERNAL_ROLES.has(result.role)) {
    return { ok: false, status: 403, error: 'Internal members only' }
  }
  return { ok: true, userId: result.userId, role: result.role as InternalRole }
}

/** owner/adminのみ。bot有効/無効の切替等、事務所の運用に影響する操作用 */
export async function requireOrgAdmin(orgId: string, request?: NextRequest): Promise<InternalAuthResult> {
  const result = await resolveMembership(orgId, request)
  if (!result.ok) {
    if (result.status === 401 || result.error === 'mfa_required') return result
    return { ok: false, status: 403, error: 'Owner or admin only' }
  }
  if (!ADMIN_ROLES.has(result.role)) {
    return { ok: false, status: 403, error: 'Owner or admin only' }
  }
  return { ok: true, userId: result.userId, role: result.role as InternalRole }
}

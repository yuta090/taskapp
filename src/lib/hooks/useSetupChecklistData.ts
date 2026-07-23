'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedUser } from '@/lib/supabase/cached-auth'
import type { SetupChecklistData } from '@/lib/onboarding/computeSetupChecklist'

export interface UseSetupChecklistDataResult extends SetupChecklistData {
  /** チェックリストを出し分けるための現在ユーザーのスペースロール（client なら非表示にする） */
  currentUserRole: string | null
  loading: boolean
}

const EMPTY: SetupChecklistData & { currentUserRole: string | null } = {
  currentUserRole: null,
  hasNonSampleTask: false,
  hasTeamInvite: false,
  hasClientInvite: false,
  hasPublishedTask: false,
  hasPreviewedPortal: false,
  hasLineLinked: false,
  lineAccess: 'unavailable',
  aiConfigured: false,
  dmUnreachable: false,
}

/**
 * オンボーディング状態(booleanのみ)をサーバーから取得する。channel_accounts / channel_user_links /
 * org_ai_config は RLSでservice_role/owner専用のためクライアント直読みできず、専用APIがbooleanだけ返す。
 * 取得失敗時は「未準備・未連携・AI未設定」に倒す（connect_line は準備中表示になり、完了不能CTAを出さない。
 * configure_ai は未設定＝警告表示になり、AI未設定を握り潰さない）。
 */
async function fetchLineStatus(
  orgId: string
): Promise<Pick<SetupChecklistData, 'hasLineLinked' | 'lineAccess' | 'aiConfigured' | 'dmUnreachable'>> {
  const VALID = ['own', 'granted', 'requested', 'none', 'unavailable'] as const
  const fail = {
    hasLineLinked: false,
    lineAccess: 'unavailable' as const,
    aiConfigured: false,
    dmUnreachable: false,
  }
  try {
    const res = await fetch(`/api/onboarding/line-status?orgId=${encodeURIComponent(orgId)}`)
    if (!res.ok) return fail
    const json = (await res.json()) as {
      hasLineLinked?: unknown
      lineAccess?: unknown
      aiConfigured?: unknown
      dmUnreachable?: unknown
    }
    const lineAccess = VALID.includes(json.lineAccess as (typeof VALID)[number])
      ? (json.lineAccess as SetupChecklistData['lineAccess'])
      : 'unavailable'
    return {
      hasLineLinked: json.hasLineLinked === true,
      lineAccess,
      aiConfigured: json.aiConfigured === true,
      dmUnreachable: json.dmUnreachable === true,
    }
  } catch {
    return fail
  }
}

/**
 * org内に対象条件のタスクが1件でもあるかを確認する。
 *
 * `tasks.is_sample` は並行ストリームが追加中の列で、`src/types/database.ts` は
 * まだ対応していないため素通しの型で問い合わせる。列が存在しない環境（未マイグレーション）
 * ではクエリがエラーになるため、is_sample 条件を外した存在チェックにフォールバックする。
 */
async function taskExists(
  supabase: SupabaseClient,
  orgId: string,
  clientScope?: 'deliverable'
): Promise<boolean> {
  let query = supabase.from('tasks').select('id').eq('org_id', orgId)
  if (clientScope) query = query.eq('client_scope', clientScope)

  const { data, error } = await query.eq('is_sample', false).limit(1)
  if (!error) return (data?.length ?? 0) > 0

  // is_sample 列が無い環境（未マイグレーション）などクエリが失敗した場合は
  // is_sample 条件を外した存在チェックにフォールバックする。
  let fallbackQuery = supabase.from('tasks').select('id').eq('org_id', orgId)
  if (clientScope) fallbackQuery = fallbackQuery.eq('client_scope', clientScope)
  const { data: fallbackData, error: fallbackError } = await fallbackQuery.limit(1)
  if (fallbackError) return false
  return (fallbackData?.length ?? 0) > 0
}

/**
 * セットアップチェックリスト(SetupChecklist)の各ステップ判定に必要なデータを集約して取得する。
 * 判定ロジック自体は computeSetupChecklist（純関数）に分離してあり、このフックはデータ取得のみを担う。
 */
export function useSetupChecklistData(orgId: string, spaceId: string): UseSetupChecklistDataResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const { data = EMPTY, isPending } = useQuery<SetupChecklistData & { currentUserRole: string | null }>({
    queryKey: ['setupChecklistData', orgId, spaceId],
    queryFn: async () => {
      const supabase = supabaseRef.current as SupabaseClient
      const { user } = await getCachedUser(supabase)
      if (!user) return EMPTY

      const [
        roleResult,
        hasNonSampleTask,
        hasPublishedTask,
        orgMembershipsResult,
        invitesResult,
        profileResult,
        lineStatus,
      ] = await Promise.all([
        supabase
          .from('space_memberships')
          .select('role')
          .eq('space_id', spaceId)
          .eq('user_id', user.id)
          .maybeSingle(),
        taskExists(supabase, orgId),
        taskExists(supabase, orgId, 'deliverable'),
        supabase.from('org_memberships').select('role').eq('org_id', orgId),
        supabase.from('invites').select('role').eq('org_id', orgId).is('accepted_at', null),
        supabase.from('profiles').select('onboarding_flags').eq('id', user.id).single(),
        fetchLineStatus(orgId),
      ])

      const currentUserRole = (roleResult.data as { role: string } | null)?.role ?? null

      const memberships = (orgMembershipsResult.data ?? []) as { role: string }[]
      const internalMemberCount = memberships.filter((m) => m.role !== 'client').length
      const hasClientMember = memberships.some((m) => m.role === 'client')

      const pendingInvites = (invitesResult.data ?? []) as { role: string }[]
      const hasPendingTeamInvite = pendingInvites.some((i) => i.role === 'member')
      const hasPendingClientInvite = pendingInvites.some((i) => i.role === 'client')

      const flags =
        (profileResult.data as { onboarding_flags: Record<string, boolean> } | null)?.onboarding_flags ?? {}

      return {
        currentUserRole,
        hasNonSampleTask,
        hasTeamInvite: internalMemberCount >= 2 || hasPendingTeamInvite,
        hasClientInvite: hasClientMember || hasPendingClientInvite,
        hasPublishedTask,
        hasPreviewedPortal: flags.portal_preview_seen === true,
        hasLineLinked: lineStatus.hasLineLinked,
        lineAccess: lineStatus.lineAccess,
        aiConfigured: lineStatus.aiConfigured,
        dmUnreachable: lineStatus.dmUnreachable,
      }
    },
    staleTime: 30_000,
    enabled: !!orgId && !!spaceId,
  })

  return { ...data, loading: isPending }
}

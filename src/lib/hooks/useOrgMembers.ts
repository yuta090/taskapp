'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface OrgMemberRole {
  userId: string
  /** org_memberships.role の値（owner | member | client） */
  role: string
  /**
   * ログインに使っているメールアドレス。
   * DB（rpc_get_org_members）が「組織のオーナー / 管理者が呼んだときだけ」返し、
   * それ以外の人には null を返す（member-directory の裁定）。画面はそのまま従う。
   */
  email: string | null
}

interface UseOrgMembersOptions {
  /**
   * 役割を変えられる人（space の管理者）がメンバー画面を開いたときだけ取りに行く。
   * 既定は true（呼び出し側で明示的に絞る）
   */
  enabled?: boolean
}

interface UseOrgMembersResult {
  members: OrgMemberRole[]
  /** user_id → 組織の役割。allowedSpaceRolesFor の入力に使う */
  roleByUserId: Map<string, string>
  /** user_id → メールアドレス。DB がメールを返さなかった人は入らない */
  emailByUserId: Map<string, string>
  /** まだ一度も取得できていない状態 */
  isPending: boolean
  /** 一度も取得できないまま失敗した（前回分は無い） */
  isLoadingError: boolean
  error: Error | null
}

const EMPTY_ORG_MEMBERS: OrgMemberRole[] = []
const EMPTY_ROLE_MAP = new Map<string, string>()
const EMPTY_EMAIL_MAP = new Map<string, string>()

/**
 * 組織メンバー一人ひとりの「組織の役割」（space の役割とは別）。
 *
 * メンバー管理画面で、役割を変えられる人（space の管理者）が開いたときだけ、
 * space のメンバー一覧（useSpaceMembers）と並行して取りに行く
 * （allowedSpaceRolesFor の入力。その人の組織の役割で、選べる役割を絞り込む）。
 *
 * space の管理者は組織の社内メンバーなので rpc_get_org_members を呼べる。
 *
 * 同じ取得から、メンバー一覧に出すメールアドレスも受け取る（`emailByUserId`）。
 * メールを返すかどうかは DB が決める（組織のオーナー / 管理者のときだけ）。
 * 個人情報なのでディスク（IndexedDB）には残さない（QueryProvider の shouldDehydrateQuery）。
 */
export function useOrgMembers(
  orgId: string | null,
  options: UseOrgMembersOptions = {}
): UseOrgMembersResult {
  const { enabled = true } = options

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryEnabled = !!orgId && enabled

  const { data, isPending, isLoadingError, error } = useQuery<OrgMemberRole[]>({
    queryKey: ['orgMembers', orgId],
    queryFn: async (): Promise<OrgMemberRole[]> => {
      const { data, error: fetchError } = await (supabase as SupabaseClient).rpc(
        'rpc_get_org_members',
        { p_org_id: orgId }
      )
      if (fetchError) throw fetchError

      return ((data ?? []) as Array<{ user_id: string; role: string; email: string | null }>).map((m) => ({
        userId: m.user_id,
        role: m.role,
        email: m.email ?? null,
      }))
    },
    enabled: queryEnabled,
    // 組織の役割は他の人（オーナー）が変えるもの。space メンバー一覧(useSpaceMembers)と
    // 同じ2分に揃える(既定のSTRUCTUREティア5分には乗せない)
    staleTime: 2 * 60_000,
  })

  const members = data ?? EMPTY_ORG_MEMBERS

  const roleByUserId = useMemo(() => {
    if (members.length === 0) return EMPTY_ROLE_MAP
    return new Map(members.map((m) => [m.userId, m.role]))
  }, [members])

  const emailByUserId = useMemo(() => {
    const withEmail = members.filter((m) => !!m.email)
    if (withEmail.length === 0) return EMPTY_EMAIL_MAP
    return new Map(withEmail.map((m) => [m.userId, m.email as string]))
  }, [members])

  return {
    members,
    roleByUserId,
    emailByUserId,
    isPending: queryEnabled && isPending,
    isLoadingError: queryEnabled && isLoadingError,
    error,
  }
}

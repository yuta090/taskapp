'use client'

import { useRef, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedUser } from '@/lib/supabase/cached-auth'
import { INTERNAL_SPACE_ROLES } from '@/lib/roles/spaceRoles'

export interface SpaceMember {
  id: string          // user_id
  displayName: string // profiles.display_name
  avatarUrl: string | null
  role: string        // admin | editor | viewer | client | vendor (from DB)
}

interface UseSpaceMembersResult {
  members: SpaceMember[]
  clientMembers: SpaceMember[]
  internalMembers: SpaceMember[]
  loading: boolean
  /**
   * まだ一度も取得できていない状態。
   * loading は既定値 [] が入るため実質いつも false で、空表示の点滅を防げない。
   * 既存の呼び出し側の挙動を変えないよう loading はそのままにして、こちらを足している。
   */
  isPending: boolean
  error: string | null
  refetch: () => Promise<void>
  /**
   * 役割変更・削除の楽観更新。戻り値を呼ぶと直前の状態へ戻せる。
   * 画面ローカルの state ではなく共有キャッシュを動かすので、担当者や承認者の選択肢など
   * 同じ一覧を見ている場所も同時に変わる。
   */
  patchMembers: (updater: (prev: SpaceMember[]) => SpaceMember[]) => () => void
  getMemberName: (userId: string) => string
}

// 読み込み中に毎レンダー新しい [] を作ると、呼び出し側の useMemo が毎回無効化されるため共有定数にする
const EMPTY_MEMBERS: SpaceMember[] = []

export function useSpaceMembers(spaceId: string | null): UseSpaceMembersResult {
  const queryClient = useQueryClient()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['spaceMembers', spaceId] as const

  const { data: members = EMPTY_MEMBERS, isPending, error: queryError } = useQuery<SpaceMember[]>({
    queryKey,
    queryFn: async (): Promise<SpaceMember[]> => {
      if (!spaceId) return []

      const { user, error: userError } = await getCachedUser(supabase)
      if (userError || !user) {
        throw new Error('ログインが必要です')
      }

      // Use RPC to get space members with profiles (avoids FK/relationship issues)
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .rpc('rpc_get_space_members', { p_space_id: spaceId })

      if (fetchError) throw fetchError

      return (data || []).map((m: { user_id: string; display_name: string | null; avatar_url: string | null; role: string }) => ({
        id: m.user_id,
        displayName: m.display_name || m.user_id.slice(0, 8) + '...',
        avatarUrl: m.avatar_url || null,
        role: m.role,
      }))
    },
    // アプリ既定(2分)に揃える。以前は30秒で既定より短く、画面を移るたびに取り直していた。
    // useUserSpaces などの STRUCTURE ティア(5分)には**乗せない**: 参加者は「他人の操作」
    // （招待の受諾・役割変更・削除）で変わるので、5分は待たせすぎになる。
    // 自分の操作ぶんは呼び出し側が refetch()/patchMembers() で即座に揃える。
    staleTime: 2 * 60_000,
    enabled: !!spaceId,
    retry: (count, err) => {
      // Don't retry auth errors
      if (err instanceof Error && err.message === 'ログインが必要です') return false
      return count < 1
    },
  })

  // Filter by role (DB uses: admin, editor, viewer, client, vendor)
  const clientMembers = useMemo(
    () => members.filter((m) => m.role === 'client'),
    [members]
  )

  // 社内側は admin/editor/viewer だけ。vendor（協力会社）は相手先と同じ社外側の役割なので、
  // ここにもクライアント側にも入れない（/vendor-portal 側の専用画面で扱う）
  const internalMembers = useMemo(
    () => members.filter((m) => (INTERNAL_SPACE_ROLES as readonly string[]).includes(m.role)),
    [members]
  )

  // Helper to get member name by ID
  const getMemberName = useCallback(
    (userId: string): string => {
      const member = members.find((m) => m.id === userId)
      return member?.displayName || userId.slice(0, 8) + '...'
    },
    [members]
  )

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['spaceMembers', spaceId] })
  }, [queryClient, spaceId])

  const patchMembers = useCallback(
    (updater: (prev: SpaceMember[]) => SpaceMember[]): (() => void) => {
      const key = ['spaceMembers', spaceId]
      const previous = queryClient.getQueryData<SpaceMember[]>(key)
      queryClient.setQueryData<SpaceMember[]>(key, (prev) => updater(prev ?? EMPTY_MEMBERS))
      return () => {
        queryClient.setQueryData<SpaceMember[] | undefined>(key, previous)
      }
    },
    [queryClient, spaceId]
  )

  // Convert Error to string for backward compatibility
  const errorMessage = queryError ? (queryError instanceof Error ? queryError.message : 'メンバー情報の取得に失敗しました') : null

  return {
    members,
    clientMembers,
    internalMembers,
    loading: isPending && !members,
    isPending,
    error: errorMessage,
    refetch,
    patchMembers,
    getMemberName,
  }
}

/**
 * Hook to get a single user's display name
 */
export function useUserName(userId: string | null): {
  name: string
  loading: boolean
} {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data: name = '', isPending } = useQuery<string>({
    queryKey: ['userName', userId],
    queryFn: async (): Promise<string> => {
      if (!userId) return ''

      const { data, error } = await (supabase as SupabaseClient)
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single()

      if (error) throw error
      return data?.display_name || userId.slice(0, 8) + '...'
    },
    // 表示名も設定と同じ STRUCTURE ティア(5分)に揃える。
    staleTime: 5 * 60_000,
    enabled: !!userId,
  })

  return { name, loading: isPending && !name }
}

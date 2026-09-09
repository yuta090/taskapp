'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InviteStatus } from '@/lib/invites/status'

export interface SpaceInvite {
  id: string
  email: string
  invitee_name: string | null
  role: string
  space_id: string
  space_name: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  status: InviteStatus
}

interface InvitesResponse {
  invites: SpaceInvite[]
  can_manage: boolean
}

const EMPTY: SpaceInvite[] = []

/**
 * プロジェクトの招待。'pending' は返事待ちだけ、'all' は期限切れ・参加済みも含めた履歴。
 * タブを開いたときだけ取りに行く。
 */
export function useSpaceInvites(spaceId: string | null, scope: 'pending' | 'all', enabled: boolean) {
  const query = useQuery<InvitesResponse>({
    queryKey: ['spaceInvites', spaceId, scope],
    enabled: enabled && !!spaceId,
    staleTime: 30_000,
    queryFn: async (): Promise<InvitesResponse> => {
      const params = new URLSearchParams({ space_id: spaceId! })
      if (scope === 'all') params.set('status', 'all')
      const res = await fetch(`/api/invites/pending?${params.toString()}`)
      if (!res.ok) throw new Error('招待の一覧を読み込めませんでした')
      return res.json()
    },
  })

  const { refetch } = query
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    invites: query.data?.invites ?? EMPTY,
    canManage: query.data?.can_manage ?? false,
    loading: enabled && !!spaceId && query.isPending && !query.data,
    error: query.error ? '招待の一覧を読み込めませんでした' : null,
    refresh,
  }
}

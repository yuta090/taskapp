'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * そのプロジェクトの「まだ承諾していない招待」。
 * 招待中の人もタスクの担当者にできるようにするため、担当者の選択肢に出す。
 * 取得は既存の /api/invites/pending?space_id=...（プロジェクトの admin/editor が呼べる）。
 */
export interface PendingInviteOption {
  id: string
  email: string
  /** 招待時に添えた名前（任意）。無ければメールを出す */
  inviteeName: string | null
  role: string
}

async function fetchPendingInvites(spaceId: string): Promise<PendingInviteOption[]> {
  const res = await fetch(`/api/invites/pending?space_id=${spaceId}`)
  if (!res.ok) return []
  const json = (await res.json()) as {
    invites?: { id: string; email: string; invitee_name?: string | null; role: string }[]
  }
  return (json.invites ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    inviteeName: i.invitee_name ?? null,
    role: i.role,
  }))
}

export function useSpacePendingInvites(spaceId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['spacePendingInvites', spaceId],
    queryFn: () => fetchPendingInvites(spaceId as string),
    enabled: !!spaceId,
    // 招待は頻繁に変わらない。開くたびに取り直さない
    staleTime: 5 * 60 * 1000,
  })
  return { pendingInvites: data ?? [], loading: isLoading }
}

/** 選択肢の表示名。名前があれば「名前（招待中）」、無ければ「メール（招待中）」 */
export function pendingInviteLabel(invite: PendingInviteOption): string {
  return `${invite.inviteeName || invite.email}（招待中）`
}

'use client'

import { useQuery } from '@tanstack/react-query'

export interface OrgUserLinkWire {
  id: string
  userId: string
  channelAccountId?: string
  linkedAt: string
}

export function orgUserLinksQueryKey(orgId: string | undefined, channelAccountId?: string) {
  return ['channelUserLinks', orgId, channelAccountId ?? null] as const
}

/**
 * org 内の本人紐づけ（channel_user_links）の一覧。channelAccountId を渡すとその口座の分だけ
 * サーバー側で絞る（Slack の画面に LINE の分を転送しない）。
 *
 * 速いページの型: react-query 経由（永続キャッシュに乗る）・1往復・データ→データの連鎖なし。
 * 書き手は同じ画面の発行/解除（SlackSelfLinkPanel）で、成功時に invalidateQueries する。
 * 設定系の他 hook（useOrgChannelAccount）と同じ5分でよい。
 */
export function useOrgUserLinks(orgId: string | undefined, channelAccountId?: string) {
  return useQuery({
    queryKey: orgUserLinksQueryKey(orgId, channelAccountId),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgUserLinkWire[]> => {
      const params = new URLSearchParams({ orgId: orgId! })
      if (channelAccountId) params.set('channelAccountId', channelAccountId)
      const res = await fetch(`/api/channels/user-links?${params.toString()}`)
      if (!res.ok) throw new Error(`user-links ${res.status}`)
      const json = (await res.json()) as { links?: OrgUserLinkWire[] }
      return json.links ?? []
    },
  })
}

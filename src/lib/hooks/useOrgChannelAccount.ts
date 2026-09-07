'use client'

import { useQuery } from '@tanstack/react-query'

export interface OrgChannelAccountWire {
  id: string
  channel: string
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  ownerType: 'org' | 'platform'
}

/**
 * org × channel（LINE 以外）の自社アカウントの状態。
 * Slack 接続ページの「いまどの手順か」（鍵を登録済みか／有効か）の表示に使う。
 *
 * 速いページの型: react-query 経由（永続キャッシュに乗る）・1往復・データ→データの連鎖なし。
 * 唯一の書き手は同じ画面の登録フォーム（ChannelCredentialForm）で、成功時に window の
 * CustomEvent（agentpm:channel-account-registered）を投げ、案内側が refetch() する。
 * そのため staleTime は設定系の他 hook（useUserSpaces）と同じ5分でよい（タブ復帰のたびに叩き直さない）。
 */
export function useOrgChannelAccount(orgId: string | undefined, channel: string) {
  return useQuery({
    queryKey: ['orgChannelAccount', orgId, channel],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgChannelAccountWire | null> => {
      const res = await fetch(`/api/channels/accounts?orgId=${encodeURIComponent(orgId!)}&channel=${encodeURIComponent(channel)}`)
      if (!res.ok) throw new Error(`accounts ${res.status}`)
      const json = (await res.json()) as { account: OrgChannelAccountWire | null }
      return json.account ?? null
    },
  })
}

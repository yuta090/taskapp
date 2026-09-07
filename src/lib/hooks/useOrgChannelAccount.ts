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
 * 登録フォームが成功したら ['orgChannelAccount', orgId, channel] を invalidate して進み具合を更新する。
 */
export function useOrgChannelAccount(orgId: string | undefined, channel: string) {
  return useQuery({
    queryKey: ['orgChannelAccount', orgId, channel],
    enabled: !!orgId,
    // 接続作業中は登録直後に状態が変わるため短め。invalidate でも更新する。
    staleTime: 30_000,
    queryFn: async (): Promise<OrgChannelAccountWire | null> => {
      const res = await fetch(`/api/channels/accounts?orgId=${encodeURIComponent(orgId!)}&channel=${encodeURIComponent(channel)}`)
      if (!res.ok) throw new Error(`accounts ${res.status}`)
      const json = (await res.json()) as { account: OrgChannelAccountWire | null }
      return json.account ?? null
    },
  })
}

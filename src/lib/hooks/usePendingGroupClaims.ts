'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

/** GET /api/channels/group-claims/pending の1行（store の PendingGroupClaim と同形） */
export interface PendingGroupClaimItem {
  id: string
  externalGroupId: string
  spaceId: string
  spaceName: string | null
  challengeLabel: string | null
  groupDisplayNameSnapshot: string | null
  createdAt: string
  channel: string | null
}

export type ClaimAction = 'approve' | 'reject'

/**
 * 「確認待ち」一覧のポーリング間隔。合言葉が投稿されて十数秒以内に自動で現れるようにする。
 * 既存の「待ち」系(useChannelIdentities / useChannelGroups)と同じ WAITING ティア(15秒)に揃える。
 * タブが裏に回っている間は止まる(refetchIntervalInBackground 既定 false)。
 */
const PENDING_REFETCH_MS = 15_000

/**
 * チャネルごとの「確認待ち」（合言葉が投稿されたチャンネルの承認/却下）。
 *
 * LINE 専用ページ(GroupLinksClient)は独自の手書きポーリングを持つが、各チャネルの
 * 「つなぐ」画面はこの react-query 版を使う。承認/却下は楽観的に行を消し、
 * 失敗したら戻して理由を行に出す（保存ボタンは無い）。
 */
export function usePendingGroupClaims(orgId: string, channel: string) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['pendingGroupClaims', orgId, channel] as const, [orgId, channel])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, ClaimAction>>({})

  const { data, isLoading, error } = useQuery<PendingGroupClaimItem[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ orgId, channel })
      const res = await fetch(`/api/channels/group-claims/pending?${params.toString()}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '取得に失敗しました')
      return (json.items ?? []) as PendingGroupClaimItem[]
    },
    enabled: !!orgId && !!channel,
    // 相手先が合言葉を投稿した直後に現れてほしいので短めに刻む（画面を開いている間だけ）。
    staleTime: PENDING_REFETCH_MS,
    refetchInterval: PENDING_REFETCH_MS,
    refetchOnWindowFocus: true,
  })

  const act = useCallback(
    async (claimId: string, action: ClaimAction) => {
      setRowErrors((prev) => {
        const next = { ...prev }
        delete next[claimId]
        return next
      })
      setBusy((prev) => ({ ...prev, [claimId]: action }))
      // 飛行中のポーリング応答が、消した行を書き戻さないよう先に打ち切る
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<PendingGroupClaimItem[]>(queryKey)
      // 楽観更新: 押した瞬間に行を消す
      queryClient.setQueryData<PendingGroupClaimItem[]>(queryKey, (old) =>
        (old ?? []).filter((it) => it.id !== claimId),
      )
      try {
        const res = await fetch('/api/channels/group-claims/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, claimId, action }),
        })
        if (!res.ok) {
          // 409 は別タブ等で処理済み。消えたままで整合する
          if (res.status === 409) return
          const json = await res.json().catch(() => ({}))
          // 402(上限・未契約)はサーバーがチャネル別に正しい案内文を返す（LINE=Pro案内、
          // それ以外=お問い合わせ）。画面側で言い換えると、Pro 契約中の事務所を課金ページへ
          // 空回りさせるので、そのまま出す。
          const msg =
            res.status === 403
              ? 'この操作を行う権限がありません。'
              : res.status === 404
                ? '対象が見つかりませんでした。'
                : (json.error ?? '処理に失敗しました')
          throw new Error(msg)
        }
        // サーバ確定後の一覧を取り直して整合させる（楽観除去の答え合わせ）
        void queryClient.invalidateQueries({ queryKey })
        if (action === 'approve') {
          // 承認で channel_groups が新規 active 化される。接続バッジ(5分SWR)を即時反映させる
          void queryClient.invalidateQueries({ queryKey: ['channelGroups', orgId] })
          void queryClient.invalidateQueries({ queryKey: ['channelGroupCounts', orgId] })
        }
      } catch (e) {
        if (previous) queryClient.setQueryData(queryKey, previous)
        setRowErrors((prev) => ({
          ...prev,
          [claimId]: e instanceof Error ? e.message : '処理に失敗しました',
        }))
      } finally {
        setBusy((prev) => {
          const next = { ...prev }
          delete next[claimId]
          return next
        })
      }
    },
    [orgId, queryClient, queryKey],
  )

  return {
    items: data ?? [],
    isLoading,
    error: error instanceof Error ? error.message : null,
    act,
    busy,
    rowErrors,
  }
}

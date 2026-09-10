'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * 決済（Stripe）を出せる状態かどうか。真実源はサーバの `/api/stripe/status`。
 *
 * **実際に起きていた不具合**: ここは長く `// TODO: Stub file` の仮実装で、環境変数の状況に
 * かかわらず**常に「未設定」を返していた**。窓口 `/api/stripe/status` は作ってあったのに
 * どこからも呼ばれておらず、本番で
 *   - 開発者向けの設定手順（環境変数名つき）が全利用者に見えていた
 *   - 「Proにアップグレード」が永久に押せない＝**自分で有料化できない**
 *   - 有料組織に「Stripeで管理」が出ない＝支払い方法の変更・請求書・解約ができない
 * という状態が続いた。仮実装を残すなら、せめて画面を止めない側（＝呼びに行く）に倒すこと。
 *
 * ⚠ ここは**表示専用**。実際の決済可否はサーバが判断する（クライアントの値は迂回できる）。
 * 取れなかったときは `false`（＝決済ボタンを開けない）に倒す。壊れた導線に人を送らないため。
 */

export interface StripeStatus {
  /** サーバ側に決済に必要な設定が揃っているか */
  serverConfigured: boolean
  /** 一部だけ設定済み（運用時の手がかり。UIの出し分けには使わない） */
  partial: boolean
  loading: boolean
  error: Error | null
}

interface StripeStatusResponse {
  configured?: unknown
  partial?: unknown
}

export const STRIPE_STATUS_QUERY_KEY = ['stripeStatus'] as const

export function useStripeStatus(): StripeStatus {
  const { data, isPending, error } = useQuery<StripeStatusResponse>({
    queryKey: STRIPE_STATUS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/stripe/status', { credentials: 'same-origin' })
      if (!res.ok) {
        throw new Error(`stripe status: ${res.status}`)
      }
      return (await res.json()) as StripeStatusResponse
    },
    // 環境変数の設定状況はデプロイ単位でしか変わらない。画面を開くたびに聞きに行かない
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  return {
    serverConfigured: data?.configured === true,
    partial: data?.partial === true,
    loading: isPending,
    error: (error as Error | null) ?? null,
  }
}

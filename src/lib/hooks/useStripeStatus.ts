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
  /**
   * 新しくオンラインで申し込めるか（鍵が揃っている AND 受け付けを開けている）。
   * 「Proにアップグレード」を出してよいかの判定はこれ。
   */
  canCheckout: boolean
  /**
   * 鍵が揃っているか。**既存契約の管理**（支払い方法の変更・請求書・解約）はこちらで判断する。
   * 受け付けを閉じたときに、既に払っている方の管理まで塞がないため、canCheckout と分けている。
   */
  keysConfigured: boolean
  /** 受け付けを開けているか（運用の手がかり） */
  selfServeEnabled: boolean
  /** 一部だけ設定済み（運用の手がかり。UIの出し分けには使わない） */
  partial: boolean
  loading: boolean
  error: Error | null
}

interface StripeStatusResponse {
  canCheckout?: unknown
  keysConfigured?: unknown
  selfServeEnabled?: unknown
  partial?: unknown
}

/** 組織ごとに1本。判定は組織で変わる（許可リスト）ので、答えを使い回さない。 */
export function stripeStatusQueryKey(orgId?: string | null) {
  return ['stripeStatus', orgId ?? null] as const
}

/**
 * @param orgId いま画面が見ている組織。省略すると全体の元栓だけで判断される
 *   （＝許可リストが効かないので、組織が分かってから渡すこと）。
 */
export function useStripeStatus(orgId?: string | null): StripeStatus {
  const { data, isPending, error } = useQuery<StripeStatusResponse>({
    queryKey: stripeStatusQueryKey(orgId),
    queryFn: async () => {
      const url = orgId
        ? `/api/stripe/status?org_id=${encodeURIComponent(orgId)}`
        : '/api/stripe/status'
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) {
        throw new Error(`stripe status: ${res.status}`)
      }
      return (await res.json()) as StripeStatusResponse
    },
    // 受け付けの開閉は運用中に切り替わる。画面を開いたときは必ず取り直す
    // （キャッシュだけ見ていると、開けた直後に来た人へ古い「準備中」を出し続ける）
    staleTime: 30 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // 一時的な失敗で申し込みと契約管理を止めないよう1回だけ再試行する
    retry: 1,
  })

  return {
    canCheckout: data?.canCheckout === true,
    keysConfigured: data?.keysConfigured === true,
    selfServeEnabled: data?.selfServeEnabled === true,
    partial: data?.partial === true,
    loading: isPending,
    error: (error as Error | null) ?? null,
  }
}

/**
 * 同時編集の帯の文面。議事録と Wiki で同じ言い回しにする（片方だけ直すと食い違う）。
 * React も yjs も使わない（画面から静かに import しても重くならない）。
 */
import type { DegradeReason } from './session'

/** 「〇〇さんが書いています」「〇〇さん、△△さんが書いています」 */
export function formatEditingMessage(peers: { name: string }[]): string {
  return `${peers.map((peer) => `${peer.name}さん`).join('、')}が書いています`
}

/**
 * 同時編集をやめて1人で書く形に戻ったときの知らせ。
 * 書いた内容が消えるわけではないので、そこを最初に伝える。
 * 本文が二重になった場合（duplicate-seed）はこの帯を出さず、列から読み直す。
 *
 * @param docName 文書の呼び方（議事録 / ページ）
 */
export function degradeMessage(reason: DegradeReason, docName = '議事録'): string | null {
  const tail = '書いた内容はこれまでどおり保存されます'
  if (reason === 'duplicate-seed') return null
  if (reason === 'too-many-peers') {
    return `開いている画面が多いので、いまは一人ずつ書く形に戻しました。${tail}`
  }
  if (reason === 'too-large') {
    return `${docName}が長くなったので、いまは一人ずつ書く形に戻しました。${tail}`
  }
  if (reason === 'peer-outdated') {
    return (
      `同じ${docName}を、更新前の画面で開いている人がいます。いまは一人ずつ書く形にします。` +
      `あとでこの画面を開き直すと、また一緒に書けます。${tail}`
    )
  }
  if (reason === 'apply-failed') {
    return `ほかの人の書いた内容を取り込めなかったので、いまは一人ずつ書く形に戻しました。${tail}`
  }
  return `つながりが切れたので、いまは一人ずつ書く形に戻しました。${tail}`
}

/** 表示に使う自分の名前。取れなければ「メンバー」（在席の既定と揃える） */
export function displayNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string {
  const metaName = user?.user_metadata?.name
  if (typeof metaName === 'string' && metaName.trim()) return metaName.trim()
  const localPart = user?.email?.split('@')[0]
  return localPart || 'メンバー'
}

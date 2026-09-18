import factsJson from './facts.json'

/**
 * 料金と上限の正本。
 *
 * 画面（料金ページ・比較ページ）と、稟議パックの資料（public/docs/）が同じ数字を使うための
 * 単一の置き場所。**数字を直すのは facts.json だけ**。
 *
 * ⚠ facts.json を直したら `npm run build:approval-pack` を実行して資料を作り直すこと。
 *   実行しないと src/__tests__/lib/pricing/pricing-facts.test.ts が落ちる（資料に古い数字が
 *   残ったまま本番へ出るのを防ぐため）。
 */
export const PRICING_FACTS = factsJson

/** 「¥14,800」の形にする。null は「個別見積り」。 */
export function yen(v: number | null): string {
  return v === null ? '個別見積り' : `¥${v.toLocaleString('ja-JP')}`
}

/** 「30名」「無制限」の形にする。 */
export function limit(v: number | null, unit: string): string {
  return v === null ? '無制限' : `${v.toLocaleString('ja-JP')}${unit}`
}

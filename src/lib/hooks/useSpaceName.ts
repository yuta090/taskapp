'use client'

import { useSpaceRow } from './useSpaceRow'

/**
 * スペース（プロジェクト）名を取得する共通フック。
 * 中身は useSpaceRow（['space', spaceId] の1行）なので、アーカイブ状態・代理店設定などを
 * 同じ画面で見ても取得は1回で済む。
 * 取得前・失敗時は空文字を返すので、呼び出し側で `spaceName || 'プロジェクト'` のように
 * フォールバックすること（パンくずに開発用サンプル名を残さないため）。
 */
export function useSpaceName(spaceId: string): string {
  const { space } = useSpaceRow(spaceId)
  return space?.name ?? ''
}

'use client'

import { useClientSnapshot } from './useClientSnapshot'

/**
 * ハイドレーション（サーバーで描いたHTMLに、ブラウザ側の状態をくっつける処理）が
 * 終わったかどうか。
 *
 * react-query の永続キャッシュ（IndexedDB）の復元は非同期で行われるが、Suspense境界の
 * 遅延ハイドレーションと組み合わさると、その復元が左メニューのハイドレーションより
 * 先に終わってしまうことがある。そうなると、サーバーが描いた「読み込み中」のHTMLに対して、
 * ブラウザ側の最初の描画（ハイドレーション時の描画）がすでに復元済みのキャッシュの中身で
 * 行われてしまい、React #418（サーバーとブラウザの最初の描画の食い違い）が起きる。
 *
 * このフックは useSyncExternalStore の getServerSnapshot を使い、「ハイドレーション時の
 * 描画では必ず false（サーバーと同じ）」「ハイドレーション完了直後の1回だけ true に
 * 切り替わる」ことを保証する。呼び出し側は、キャッシュや localStorage に依って中身が
 * 変わる表示を、この値が true になるまではサーバーと同じ表示（読み込み中の枠など）に
 * しておき、true になった直後にキャッシュの中身をすぐ出す（通信を待たない）。
 */
export function useHydrated(): boolean {
  return useClientSnapshot(() => true, false)
}

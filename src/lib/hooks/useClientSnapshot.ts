'use client'

import { useSyncExternalStore } from 'react'

/** セッション中に変化しない値なので、購読は何もしない */
const noopSubscribe = () => () => {}

/**
 * ブラウザにしか無い値（localStorage・Notification.permission・PWAかどうか等）を、
 * サーバー描画とズレずに読む。
 *
 * useEffect + setState でも同じことはできるが、それは lint の
 * react-hooks/set-state-in-effect が禁じている書き方になる。
 * useSyncExternalStore なら「サーバーではこの値・クライアントではこの値」を
 * ハイドレーション不一致なしに宣言できる（描画回数が減るわけではない。
 * サーバー値で描いたあと、クライアント値でもう一度描かれる）。
 *
 * @param read クライアントでの読み取り。同じ入力なら同じ値を返すこと（毎回別のオブジェクトを
 *             作ると無限に再描画される。プリミティブを返すのが安全）
 * @param serverValue サーバー描画・ハイドレーション直前に使う値
 */
export function useClientSnapshot<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => serverValue)
}

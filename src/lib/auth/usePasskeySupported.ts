'use client'

import { useSyncExternalStore } from 'react'
import { isPasskeySupported } from './passkey'

const noopSubscribe = () => () => {}

/** ブラウザがパスキーに対応しているか。サーバー描画では false（描画の食い違いを避ける） */
export function usePasskeySupported(): boolean {
  return useSyncExternalStore(noopSubscribe, isPasskeySupported, () => false)
}

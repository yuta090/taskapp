'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import {
  readStoredTheme,
  resolveDark,
  applyDarkClass,
  THEME_STORAGE_KEY,
} from '@/lib/theme/theme'

/**
 * <html> の .dark を「現在パス × 保存テーマ × OS設定」で常に正しく保つ。
 * 初回の付与は layout の描画前inline scriptが担当（FOUC防止）。この component は
 * その後の SPA遷移・OS設定変更・他タブ更新・設定画面のトグルに追随する役目。
 *
 * - 遷移追随: アプリ→portal 等でダーク対象外に移ったらライトへ戻す
 * - system 追随: matchMedia change
 * - 他タブ同期: storage イベント
 * - 同一タブのトグル: 設定画面が dispatch する 'taskapp:theme-change'
 */
export function ThemeSync() {
  const pathname = usePathname()

  useEffect(() => {
    const apply = () => applyDarkClass(resolveDark(readStoredTheme(), pathname))
    apply()

    const mql = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onMedia = () => apply()
    mql?.addEventListener?.('change', onMedia)

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === null) apply()
    }
    window.addEventListener('storage', onStorage)

    const onThemeChange = () => apply()
    window.addEventListener('taskapp:theme-change', onThemeChange)

    return () => {
      mql?.removeEventListener?.('change', onMedia)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('taskapp:theme-change', onThemeChange)
    }
  }, [pathname])

  return null
}

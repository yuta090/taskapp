import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isDarkAllowedPath,
  isValidTheme,
  readStoredTheme,
  systemPrefersDark,
  resolveDark,
  buildThemeInitScript,
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
} from '@/lib/theme/theme'
import { publicPaths } from '@/lib/routes/publicPaths'

describe('isDarkAllowedPath', () => {
  it('ログイン後のアプリ画面は許可', () => {
    expect(isDarkAllowedPath('/inbox')).toBe(true)
    expect(isDarkAllowedPath('/org-1/project/space-1')).toBe(true)
    expect(isDarkAllowedPath('/settings/preferences')).toBe(true)
  })

  it('公開/マーケ・診断はライト固定（不許可）', () => {
    expect(isDarkAllowedPath('/')).toBe(false)
    expect(isDarkAllowedPath('/pricing')).toBe(false)
    expect(isDarkAllowedPath('/task6/some-article')).toBe(false)
    expect(isDarkAllowedPath('/shindan')).toBe(false)
    expect(isDarkAllowedPath('/login')).toBe(false)
    expect(isDarkAllowedPath('/lp1')).toBe(false)
  })

  it('クライアント向け portal / vendor-portal はライト固定（不許可）', () => {
    expect(isDarkAllowedPath('/portal')).toBe(false)
    expect(isDarkAllowedPath('/portal/abc')).toBe(false)
    expect(isDarkAllowedPath('/vendor-portal')).toBe(false)
    expect(isDarkAllowedPath('/vendor-portal/xyz')).toBe(false)
  })

  it('セグメント境界を守る（/portalX は portal 扱いしない）', () => {
    expect(isDarkAllowedPath('/portalX')).toBe(true)
  })
})

describe('isValidTheme', () => {
  it('light/dark/system のみ true', () => {
    expect(isValidTheme('light')).toBe(true)
    expect(isValidTheme('dark')).toBe(true)
    expect(isValidTheme('system')).toBe(true)
    expect(isValidTheme('blue')).toBe(false)
    expect(isValidTheme(null)).toBe(false)
    expect(isValidTheme(undefined)).toBe(false)
  })
})

describe('readStoredTheme', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('未設定なら既定 light', () => {
    expect(readStoredTheme()).toBe(DEFAULT_THEME)
  })
  it('保存値を読む', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readStoredTheme()).toBe('dark')
  })
  it('不正値は既定 light にフォールバック', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'weird')
    expect(readStoredTheme()).toBe('light')
  })
})

describe('systemPrefersDark / resolveDark', () => {
  const setMatch = (matches: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia
  }

  it('systemPrefersDark は matchMedia を反映', () => {
    setMatch(true)
    expect(systemPrefersDark()).toBe(true)
    setMatch(false)
    expect(systemPrefersDark()).toBe(false)
  })

  it('light は常に false', () => {
    setMatch(true)
    expect(resolveDark('light', '/inbox')).toBe(false)
  })

  it('dark はアプリ画面で true・対象外パスで false', () => {
    setMatch(false)
    expect(resolveDark('dark', '/inbox')).toBe(true)
    expect(resolveDark('dark', '/portal')).toBe(false)
    expect(resolveDark('dark', '/pricing')).toBe(false)
  })

  it('system は OS 設定に従う（アプリ画面のみ）', () => {
    setMatch(true)
    expect(resolveDark('system', '/inbox')).toBe(true)
    expect(resolveDark('system', '/portal')).toBe(false)
    setMatch(false)
    expect(resolveDark('system', '/inbox')).toBe(false)
  })
})

describe('buildThemeInitScript', () => {
  it('publicPaths とストレージキーを埋め込む（単一ソース由来）', () => {
    const s = buildThemeInitScript()
    expect(s).toContain(THEME_STORAGE_KEY)
    // 代表的な公開パスがスクリプトに直列化されている
    expect(s).toContain('/pricing')
    expect(s).toContain('/task6')
    // portal 除外
    expect(s).toContain('/portal')
    expect(s).toContain('/vendor-portal')
    // publicPaths 全件が含まれること（ドリフト検知）
    for (const p of publicPaths) expect(s).toContain(p)
  })

  const runScript = (theme: string, pathname: string) => {
    const added: string[] = []
    const fn = new Function('localStorage', 'window', 'location', 'document', buildThemeInitScript())
    fn(
      { getItem: () => theme },
      { matchMedia: () => ({ matches: true }) },
      { pathname },
      { documentElement: { classList: { add: (c: string) => added.push(c) } } },
    )
    return added
  }

  it('dark×アプリ画面で .dark を付与する', () => {
    expect(runScript('dark', '/inbox')).toContain('dark')
  })
  it('dark でも portal/公開では付与しない', () => {
    expect(runScript('dark', '/portal')).not.toContain('dark')
    expect(runScript('dark', '/pricing')).not.toContain('dark')
  })
  it('light では付与しない（早期return・例外なし）', () => {
    expect(runScript('light', '/inbox')).not.toContain('dark')
  })
})

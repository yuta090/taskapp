/**
 * <html class="dark"> の付け外しに追随するか。
 * BlockNote のように「色をCSSでなくReactのpropsで受け取る」部品に、
 * いまダークかどうかを渡すために使う。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsDarkTheme } from '@/lib/hooks/useIsDarkTheme'

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('useIsDarkTheme', () => {
  it('.dark が無ければ false', () => {
    const { result } = renderHook(() => useIsDarkTheme())
    expect(result.current).toBe(false)
  })

  it('最初から .dark が付いていれば true', () => {
    document.documentElement.classList.add('dark')
    const { result } = renderHook(() => useIsDarkTheme())
    expect(result.current).toBe(true)
  })

  it('あとから .dark が付いたら true に変わる（テーマ切替に追随する）', async () => {
    const { result } = renderHook(() => useIsDarkTheme())
    expect(result.current).toBe(false)

    await act(async () => {
      document.documentElement.classList.add('dark')
      // MutationObserver はマイクロタスクで流れる
      await Promise.resolve()
    })
    expect(result.current).toBe(true)

    await act(async () => {
      document.documentElement.classList.remove('dark')
      await Promise.resolve()
    })
    expect(result.current).toBe(false)
  })
})

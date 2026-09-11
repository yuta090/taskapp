import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isNavigationAbort, __resetNavigationLeavingStateForTest } from '@/lib/net/isNavigationAbort'

/**
 * ログイン直後など、移り先のページがまだ読み込み中のうちに別ページへフル移動すると、
 * その場で走っていた fetch がブラウザに打ち切られる（net::ERR_ABORTED）。これは通信障害
 * ではなく利用者への実害も無いため、console.error でエラー記録しない対象にしたい。
 *
 * 判定は「AbortError」か「pagehide/beforeunload の後に失敗した fetch 系エラー」のどちらか。
 * ふつうに失敗しただけの通信（ページ移動と無関係）は今までどおりエラー扱いする。
 */
describe('isNavigationAbort', () => {
  beforeEach(() => {
    __resetNavigationLeavingStateForTest()
  })

  it('AbortError は常に打ち切り扱い（ページ移動前でも）', () => {
    const err = new DOMException('The operation was aborted', 'AbortError')
    expect(isNavigationAbort(err)).toBe(true)
  })

  it('name だけ AbortError な plain object でも打ち切り扱い', () => {
    expect(isNavigationAbort({ name: 'AbortError', message: 'aborted' })).toBe(true)
  })

  it('pagehide 発火後の "Failed to fetch"(TypeError) は打ち切り扱い', () => {
    window.dispatchEvent(new Event('pagehide'))
    const err = new TypeError('Failed to fetch')
    expect(isNavigationAbort(err)).toBe(true)
  })

  it('beforeunload 発火後の "Failed to fetch"(TypeError) も打ち切り扱い', () => {
    window.dispatchEvent(new Event('beforeunload'))
    const err = new TypeError('Failed to fetch')
    expect(isNavigationAbort(err)).toBe(true)
  })

  it('Safari の "Load failed" 表記も打ち切り扱い', () => {
    window.dispatchEvent(new Event('pagehide'))
    const err = new TypeError('Load failed')
    expect(isNavigationAbort(err)).toBe(true)
  })

  it('ページ移動していない、ふつうの "Failed to fetch" は打ち切りではない', () => {
    const err = new TypeError('Failed to fetch')
    expect(isNavigationAbort(err)).toBe(false)
  })

  it('pagehide 後でも、fetch失敗と無関係な TypeError は打ち切りにしない', () => {
    window.dispatchEvent(new Event('pagehide'))
    const err = new TypeError('Cannot read properties of undefined')
    expect(isNavigationAbort(err)).toBe(false)
  })

  it('pagehide 後でも、fetch と無関係な通常の Error は打ち切りにしない', () => {
    window.dispatchEvent(new Event('pagehide'))
    const err = new Error('some other failure')
    expect(isNavigationAbort(err)).toBe(false)
  })

  it('null/undefined は打ち切りではない', () => {
    expect(isNavigationAbort(null)).toBe(false)
    expect(isNavigationAbort(undefined)).toBe(false)
  })

  // supabase-js（postgrest-js）は fetch の失敗を素のオブジェクトに包み直して返す
  // （`{ message: 'TypeError: Failed to fetch', code: '', hint: '' }` のような形。本番の
  // 実際の失敗形はこちら）。ActiveOrgProvider 等はこの形のまま console.error に渡すため、
  // Error インスタンスでなくても判定できる必要がある
  it('supabase-js が包み直した AbortError 形のオブジェクトも打ち切り扱い', () => {
    const err = { message: 'AbortError: The operation was aborted', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' }
    expect(isNavigationAbort(err)).toBe(true)
  })

  it('supabase-js が包み直した "TypeError: Failed to fetch" 形は、pagehide 後だけ打ち切り扱い', () => {
    const err = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }
    expect(isNavigationAbort(err)).toBe(false)

    window.dispatchEvent(new Event('pagehide'))
    expect(isNavigationAbort(err)).toBe(true)
  })

  // @supabase/auth-js（auth.getUser() 等）は fetch の失敗を必ず AuthRetryableFetchError に
  // 包み直す。name は常に 'AuthRetryableFetchError' に潰され、元の AbortError かどうかは
  // message でしか判別できない（例: "The operation was aborted."）
  it('auth-js の AuthRetryableFetchError（name固定・message="The operation was aborted."）は、pagehide 後だけ打ち切り扱い', () => {
    const err = { name: 'AuthRetryableFetchError', message: 'The operation was aborted.', status: 0 }
    expect(isNavigationAbort(err)).toBe(false)

    window.dispatchEvent(new Event('pagehide'))
    expect(isNavigationAbort(err)).toBe(true)
  })

  it('auth-js の AuthRetryableFetchError（message="Failed to fetch"）は、pagehide 後だけ打ち切り扱い', () => {
    const err = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }
    expect(isNavigationAbort(err)).toBe(false)

    window.dispatchEvent(new Event('pagehide'))
    expect(isNavigationAbort(err)).toBe(true)
  })

  // 「戻る」で bfcache から画面が丸ごと復元されると pageshow が発火する。ここで旗を下ろさないと、
  // 復元後の画面で起きた本当の通信障害まで打ち切り扱いになり記録されなくなってしまう
  it('pagehide の後に pageshow（bfcache 復帰等）が来たら、以後の失敗は打ち切り扱いにしない', () => {
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pageshow'))

    const err = new TypeError('Failed to fetch')
    expect(isNavigationAbort(err)).toBe(false)
  })

  // beforeunload は「ユーザーが移動を止める」と発火したのにページに留まるケースがあり
  // （確認ダイアログでキャンセル等）、その場合は pagehide も pageshow も来ないため旗が
  // 立ちっぱなしになる。時刻だけ記録し、数秒以内だけ「離脱中」とみなすことで、
  // 移動が実際には起きなかった場合に旗が永続しないようにする
  it('beforeunload 後は数秒だけ離脱中とみなす。時間が経つと打ち切り判定に使わなくなる', () => {
    vi.useFakeTimers()
    try {
      window.dispatchEvent(new Event('beforeunload'))
      const err = new TypeError('Failed to fetch')
      expect(isNavigationAbort(err)).toBe(true)

      vi.advanceTimersByTime(5_001)
      expect(isNavigationAbort(err)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

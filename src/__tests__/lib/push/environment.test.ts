import { describe, it, expect } from 'vitest'
import { detectPushEnvironment, isIosDevice } from '@/lib/push/environment'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

describe('detectPushEnvironment', () => {
  it('APIが揃っていれば対応', () => {
    expect(detectPushEnvironment({ userAgent: MAC, hasPushApi: true, isStandalone: false })).toBe('supported')
    expect(detectPushEnvironment({ userAgent: IPHONE, hasPushApi: true, isStandalone: true })).toBe('supported')
  })

  it('iPhoneのふつうのタブは「ホーム画面に追加すれば使える」', () => {
    expect(detectPushEnvironment({ userAgent: IPHONE, hasPushApi: false, isStandalone: false })).toBe(
      'ios_needs_home_screen',
    )
  })

  it('iPhone以外でAPIが無ければ本当に非対応', () => {
    expect(detectPushEnvironment({ userAgent: MAC, hasPushApi: false, isStandalone: false })).toBe('unsupported')
  })

  it('Macに「ホーム画面に追加」を案内しない', () => {
    expect(isIosDevice(MAC)).toBe(false)
    expect(isIosDevice(IPHONE)).toBe(true)
  })
})

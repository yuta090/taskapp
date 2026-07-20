import { describe, it, expect } from 'vitest'
import { deriveLineSelfServeState, canUseSharedBotClaims } from '@/lib/channels/sharedBotAccess'

describe('deriveLineSelfServeState', () => {
  it('自社account が active なら own（共有bot状態に関わらず最優先）', () => {
    expect(
      deriveLineSelfServeState({ hasOwnActiveLineAccount: true, hasPlatformActiveLineAccount: true, sharedBotAccess: 'none' }),
    ).toBe('own')
    expect(
      deriveLineSelfServeState({ hasOwnActiveLineAccount: true, hasPlatformActiveLineAccount: false, sharedBotAccess: 'none' }),
    ).toBe('own')
  })

  it('共有bot が無ければ unavailable（プロビジョニング前）', () => {
    expect(
      deriveLineSelfServeState({ hasOwnActiveLineAccount: false, hasPlatformActiveLineAccount: false, sharedBotAccess: 'granted' }),
    ).toBe('unavailable')
  })

  it('共有bot あり × access で granted/requested/none を出し分ける', () => {
    const base = { hasOwnActiveLineAccount: false, hasPlatformActiveLineAccount: true }
    expect(deriveLineSelfServeState({ ...base, sharedBotAccess: 'granted' })).toBe('granted')
    expect(deriveLineSelfServeState({ ...base, sharedBotAccess: 'requested' })).toBe('requested')
    expect(deriveLineSelfServeState({ ...base, sharedBotAccess: 'none' })).toBe('none')
  })
})

describe('canUseSharedBotClaims', () => {
  it('own と granted だけ claim 発行/承認を許す', () => {
    expect(canUseSharedBotClaims('own')).toBe(true)
    expect(canUseSharedBotClaims('granted')).toBe(true)
    expect(canUseSharedBotClaims('requested')).toBe(false)
    expect(canUseSharedBotClaims('none')).toBe(false)
    expect(canUseSharedBotClaims('unavailable')).toBe(false)
  })
})

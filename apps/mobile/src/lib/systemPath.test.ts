import { describe, expect, it } from 'vitest'
import { redirectSystemPath } from './systemPath'

describe('redirectSystemPath', () => {
  it('Google ログインの戻りリンクは画面遷移に使わない（ログイン処理が受け取る）', () => {
    expect(redirectSystemPath('agentpm://auth/callback?code=abc')).toBeNull()
    expect(redirectSystemPath('/auth/callback?code=abc')).toBeNull()
  })
  it('それ以外のリンクはそのまま', () => {
    expect(redirectSystemPath('agentpm://task/123')).toBe('agentpm://task/123')
    expect(redirectSystemPath('/inbox')).toBe('/inbox')
  })
})

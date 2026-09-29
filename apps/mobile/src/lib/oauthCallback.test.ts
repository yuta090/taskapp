import { describe, expect, it } from 'vitest'
import { parseOAuthCallback } from './oauthCallback'

describe('parseOAuthCallback', () => {
  it('戻ってきた URL から認可コードを取り出す', () => {
    expect(parseOAuthCallback('agentpm://auth/callback?code=abc123')).toEqual({ code: 'abc123' })
  })
  it('Google 側で断った・失敗したときは理由を返す（コードは使わない）', () => {
    expect(parseOAuthCallback('agentpm://auth/callback?error=access_denied&error_description=User%20denied')).toEqual({
      error: 'User denied',
    })
  })
  it('理由の説明が無ければエラーの種類を返す', () => {
    expect(parseOAuthCallback('agentpm://auth/callback?error=server_error')).toEqual({ error: 'server_error' })
  })
  it('フラグメント（#）で返ってきたエラーも読む', () => {
    expect(parseOAuthCallback('agentpm://auth/callback#error=access_denied')).toEqual({ error: 'access_denied' })
  })
  it('コードもエラーも無ければ、失敗として扱う', () => {
    expect(parseOAuthCallback('agentpm://auth/callback')).toEqual({ error: 'ログインの結果を受け取れませんでした' })
  })
})

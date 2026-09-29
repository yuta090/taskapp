import { describe, expect, it } from 'vitest'
import { approvalEmailSent, buildWebApiRequest } from './webApi'

describe('buildWebApiRequest', () => {
  it('アクセストークンを Bearer で付けて、JSON で POST する', () => {
    const req = buildWebApiRequest('https://agentpm.app', '/api/slack/notify', 'jwt-1', { a: 1 })
    expect(req.url).toBe('https://agentpm.app/api/slack/notify')
    expect(req.init.method).toBe('POST')
    expect(req.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt-1' })
    expect(req.init.body).toBe('{"a":1}')
  })
  it('末尾の / を重ねない', () => {
    expect(buildWebApiRequest('https://agentpm.app/', '/api/x', 't', {}).url).toBe('https://agentpm.app/api/x')
  })
  it('https 以外にはトークンを送らない（開発中の localhost だけ例外）', () => {
    expect(() => buildWebApiRequest('http://agentpm.app', '/api/x', 't', {})).toThrow()
    expect(buildWebApiRequest('http://localhost:4000', '/api/x', 't', {}).url).toBe('http://localhost:4000/api/x')
  })
  it('トークンが要らない呼び出しでは Authorization を付けない', () => {
    expect(buildWebApiRequest('https://agentpm.app', '/api/x', null, {}).init.headers).toEqual({
      'Content-Type': 'application/json',
    })
  })
})

describe('approvalEmailSent', () => {
  it('送れた件数が1件以上のときだけ、送れたとみなす', () => {
    expect(approvalEmailSent(true, { success: true, sent: 1 })).toBe(true)
  })
  it('サーバーは失敗や「送る相手がいない」でも 200 を返すので、中身で見る', () => {
    expect(approvalEmailSent(true, { error: 'Internal error' })).toBe(false)
    expect(approvalEmailSent(true, { skipped: true, reason: 'no client members' })).toBe(false)
    expect(approvalEmailSent(true, { success: true, sent: 0 })).toBe(false)
  })
  it('エラーの応答・読めない中身は送れていない', () => {
    expect(approvalEmailSent(false, { success: true, sent: 1 })).toBe(false)
    expect(approvalEmailSent(true, null)).toBe(false)
  })
})

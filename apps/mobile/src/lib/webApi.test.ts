import { describe, expect, it } from 'vitest'
import { buildWebApiRequest } from './webApi'

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

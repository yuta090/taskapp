import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * スマホアプリのログインが切れた端末（他の端末から全端末ログアウトした等）は、もう自分の行を消せない。
 * そのままだと前の人の通知がその端末に届き続けるので、トークン文字列を持っていることを証明にして消す。
 * 認証なし。消すのはトークンが一致する行だけで、行の有無は返さない。
 */

const deleteEq = vi.fn(async (..._args: unknown[]) => ({ error: null }))
const deleteMock = vi.fn(() => ({ eq: deleteEq }))
const fromMock = vi.fn(() => ({ delete: deleteMock }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { POST } = await import('@/app/api/mobile/push-token/unregister/route')

function call(body: unknown) {
  return POST(
    new NextRequest(new URL('/api/mobile/push-token/unregister', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

describe('POST /api/mobile/push-token/unregister', () => {
  beforeEach(() => vi.clearAllMocks())

  it('トークンが一致する行だけを消し、ok を返す', async () => {
    const res = await call({ token: 'ExponentPushToken[abc123]' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(fromMock).toHaveBeenCalledWith('mobile_push_tokens')
    expect(deleteEq).toHaveBeenCalledWith('token', 'ExponentPushToken[abc123]')
  })

  it('body の user_id などは使わない（トークンだけで絞る）', async () => {
    await call({ token: 'ExpoPushToken[x]', user_id: 'someone' })
    expect(deleteEq).toHaveBeenCalledTimes(1)
    expect(deleteEq).toHaveBeenCalledWith('token', 'ExpoPushToken[x]')
  })

  it('Expo のトークンの形でなければ 400 で、消さない', async () => {
    for (const token of ['', 'abc', 'ExponentPushToken[]', `ExponentPushToken[${'a'.repeat(300)}]`, 42]) {
      const res = await call({ token })
      expect(res.status).toBe(400)
    }
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('JSON でなければ 400', async () => {
    expect((await call('not json')).status).toBe(400)
  })

  it('DB でエラーになっても、行の有無が分かる返し方はしない（500 だけ）', async () => {
    deleteEq.mockResolvedValueOnce({ error: { message: 'db down' } } as never)
    const res = await call({ token: 'ExponentPushToken[abc123]' })
    expect(res.status).toBe(500)
  })
})

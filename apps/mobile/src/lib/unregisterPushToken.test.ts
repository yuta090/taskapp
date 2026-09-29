import { describe, expect, it, vi } from 'vitest'
import { unregisterPushToken } from './unregisterPushToken'

function deps(over: Partial<Parameters<typeof unregisterPushToken>[0]> = {}) {
  return {
    getStoredToken: vi.fn(async () => 'ExponentPushToken[a]' as string | null),
    deleteTokenRow: vi.fn(async (_token: string) => ({ error: null as unknown })),
    clearStoredToken: vi.fn(async () => {}),
    ...over,
  }
}

describe('unregisterPushToken', () => {
  it('DB から自分の行を消し、端末に覚えたトークンも消す', async () => {
    const d = deps()
    expect(await unregisterPushToken(d)).toBe('removed')
    expect(d.deleteTokenRow).toHaveBeenCalledWith('ExponentPushToken[a]')
    expect(d.clearStoredToken).toHaveBeenCalled()
  })

  it('DB から消せなかったら、覚えたトークンを残す（次のログアウト・ログインでやり直せるように）', async () => {
    const d = deps({ deleteTokenRow: vi.fn(async () => ({ error: { message: 'network' } as unknown })) })
    expect(await unregisterPushToken(d)).toBe('failed')
    expect(d.clearStoredToken).not.toHaveBeenCalled()
  })

  it('通信エラーで投げられても、ログアウトは止めない（失敗として返す）', async () => {
    const d = deps({
      deleteTokenRow: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    expect(await unregisterPushToken(d)).toBe('failed')
  })

  it('登録していなければ何もしない', async () => {
    const d = deps({ getStoredToken: vi.fn(async () => null) })
    expect(await unregisterPushToken(d)).toBe('none')
    expect(d.deleteTokenRow).not.toHaveBeenCalled()
  })
})

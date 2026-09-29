import { describe, expect, it, vi } from 'vitest'
import { cleanupPushAfterSignedOut } from './signedOutCleanup'

function deps(over: Partial<Parameters<typeof cleanupPushAfterSignedOut>[0]> = {}) {
  return {
    manual: false,
    getStoredToken: vi.fn(async () => 'ExponentPushToken[a]' as string | null),
    postUnregister: vi.fn(async (_token: string) => true),
    clearStoredToken: vi.fn(async () => {}),
    ...over,
  }
}

describe('cleanupPushAfterSignedOut', () => {
  it('自分でログアウトしていない（期限切れ・他の端末から全端末ログアウト）なら、サーバーにトークンを渡して宛先を外す', async () => {
    const d = deps()
    await cleanupPushAfterSignedOut(d)
    expect(d.postUnregister).toHaveBeenCalledWith('ExponentPushToken[a]')
    expect(d.clearStoredToken).toHaveBeenCalled()
  })

  it('自分でログアウトしたときは何もしない（ログアウトの前に自分で外している）', async () => {
    const d = deps({ manual: true })
    await cleanupPushAfterSignedOut(d)
    expect(d.postUnregister).not.toHaveBeenCalled()
  })

  it('外せなかったら、覚えたトークンを残す（次にやり直せるように）', async () => {
    const d = deps({ postUnregister: vi.fn(async () => false) })
    await cleanupPushAfterSignedOut(d)
    expect(d.clearStoredToken).not.toHaveBeenCalled()
  })

  it('通信エラーでも投げない', async () => {
    const d = deps({
      postUnregister: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    await expect(cleanupPushAfterSignedOut(d)).resolves.toBeUndefined()
  })

  it('登録していなければ何もしない', async () => {
    const d = deps({ getStoredToken: vi.fn(async () => null) })
    await cleanupPushAfterSignedOut(d)
    expect(d.postUnregister).not.toHaveBeenCalled()
  })
})

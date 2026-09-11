import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * インストール完了時に、GitHub 側で利用者本人であることを確認するための
 * user-to-server トークン操作（交換・所属確認・破棄）。
 *
 * トークンは戻り値として受け渡すだけで、どこにも保存しない・ログに出さない。
 */
describe('exchangeCodeForUserToken', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'client-id-1')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'client-secret-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = originalFetch
    vi.resetModules()
  })

  it('code をアクセストークンに交換する', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'gho_user-token', token_type: 'bearer' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { exchangeCodeForUserToken } = await import('./userAuth')
    const token = await exchangeCodeForUserToken('code-123')

    expect(token).toBe('gho_user-token')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://github.com/login/oauth/access_token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('client_id')).toBe('client-id-1')
    expect(body.get('client_secret')).toBe('client-secret-1')
    expect(body.get('code')).toBe('code-123')
    // GitHub App のインストール時 OAuth は redirect_uri を必須にしない
    expect(body.get('redirect_uri')).toBeNull()
  })

  it('GitHub がエラー応答を返したら null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 'bad_verification_code' }),
        }),
      ),
    )
    const { exchangeCodeForUserToken } = await import('./userAuth')
    expect(await exchangeCodeForUserToken('bad-code')).toBeNull()
  })

  it('HTTP エラーなら null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
    const { exchangeCodeForUserToken } = await import('./userAuth')
    expect(await exchangeCodeForUserToken('code-123')).toBeNull()
  })
})

describe('findUserInstallation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('利用者のインストール一覧に installation_id があれば、その項目を返す', async () => {
    const matched = { id: 222, account: { id: 999, login: 'yuta090', type: 'User' } }
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ installations: [{ id: 111, account: { id: 1, login: 'a', type: 'User' } }, matched] }),
        }),
      ),
    )
    const { findUserInstallation } = await import('./userAuth')
    expect(await findUserInstallation('token', 222)).toEqual(matched)
  })

  it('一覧に含まれていなければ null（ページを尽きるまで確認する）', async () => {
    const fetchMock = vi.fn((url: string) => {
      const page = new URL(url).searchParams.get('page')
      if (page === '1') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i, account: { id: i, login: `u${i}`, type: 'User' } })) }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ installations: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { findUserInstallation } = await import('./userAuth')
    expect(await findUserInstallation('token', 999999)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('2ページ目に installation_id があっても見つかる', async () => {
    const matched = { id: 12345, account: { id: 42, login: 'acme', type: 'Organization' } }
    const fetchMock = vi.fn((url: string) => {
      const page = new URL(url).searchParams.get('page')
      if (page === '1') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i, account: { id: i, login: `u${i}`, type: 'User' } })) }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ installations: [matched] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { findUserInstallation } = await import('./userAuth')
    expect(await findUserInstallation('token', 12345)).toEqual(matched)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ページ数に上限があり、無限には確認し続けない', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i, account: { id: i, login: `u${i}`, type: 'User' } })) }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { findUserInstallation } = await import('./userAuth')
    expect(await findUserInstallation('token', 999999)).toBeNull()
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(100)
  })

  it('GitHub API がエラーを返したら null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
    const { findUserInstallation } = await import('./userAuth')
    expect(await findUserInstallation('token', 111)).toBeNull()
  })
})

describe('getAuthenticatedGitHubUser', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('GET /user から id・login を返す', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 999, login: 'yuta090', name: 'Yuta' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { getAuthenticatedGitHubUser } = await import('./userAuth')

    expect(await getAuthenticatedGitHubUser('token')).toEqual({ id: 999, login: 'yuta090' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/user')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
  })

  it('HTTP エラーなら null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
    const { getAuthenticatedGitHubUser } = await import('./userAuth')
    expect(await getAuthenticatedGitHubUser('token')).toBeNull()
  })

  it('通信に失敗したら null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
    const { getAuthenticatedGitHubUser } = await import('./userAuth')
    expect(await getAuthenticatedGitHubUser('token')).toBeNull()
  })

  it('GitHub がエラー応答を返したら、ステータスだけをログに出す（トークンは出さない）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getAuthenticatedGitHubUser } = await import('./userAuth')

    expect(await getAuthenticatedGitHubUser('gho_user-token')).toBeNull()

    expect(errorSpy).toHaveBeenCalled()
    const loggedArgs = errorSpy.mock.calls.flat()
    expect(loggedArgs).toContain(401)
    expect(JSON.stringify(loggedArgs)).not.toContain('gho_user-token')
    errorSpy.mockRestore()
  })
})

describe('isOrgAdmin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('state=active かつ role=admin なら true', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'active', role: 'admin' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { isOrgAdmin } = await import('./userAuth')

    expect(await isOrgAdmin('token', 'acme-corp')).toBe(true)
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.github.com/user/memberships/orgs/acme-corp')
  })

  it('role=member なら false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'active', role: 'member' }) })))
    const { isOrgAdmin } = await import('./userAuth')
    expect(await isOrgAdmin('token', 'acme-corp')).toBe(false)
  })

  it('state=pending（承認待ち）なら false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'pending', role: 'admin' }) })))
    const { isOrgAdmin } = await import('./userAuth')
    expect(await isOrgAdmin('token', 'acme-corp')).toBe(false)
  })

  it('404（非所属）なら false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })))
    const { isOrgAdmin } = await import('./userAuth')
    expect(await isOrgAdmin('token', 'acme-corp')).toBe(false)
  })

  it('403 なら false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })))
    const { isOrgAdmin } = await import('./userAuth')
    expect(await isOrgAdmin('token', 'acme-corp')).toBe(false)
  })

  it('通信に失敗したら false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
    const { isOrgAdmin } = await import('./userAuth')
    expect(await isOrgAdmin('token', 'acme-corp')).toBe(false)
  })

  it('組織名を URL エンコードして問い合わせる', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'active', role: 'admin' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { isOrgAdmin } = await import('./userAuth')

    await isOrgAdmin('token', 'a/org name')

    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe(`https://api.github.com/user/memberships/orgs/${encodeURIComponent('a/org name')}`)
  })

  it('GitHub がエラー応答を返したら、ステータスだけをログに出す（トークンは出さない）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { isOrgAdmin } = await import('./userAuth')

    expect(await isOrgAdmin('gho_user-token', 'acme-corp')).toBe(false)

    expect(errorSpy).toHaveBeenCalled()
    const loggedArgs = errorSpy.mock.calls.flat()
    expect(loggedArgs).toContain(403)
    expect(JSON.stringify(loggedArgs)).not.toContain('gho_user-token')
    errorSpy.mockRestore()
  })
})

describe('revokeUserToken', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'client-id-1')
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'client-secret-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('DELETE でトークンを破棄する', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { revokeUserToken } = await import('./userAuth')

    await revokeUserToken('gho_user-token')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/applications/client-id-1/token')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ access_token: 'gho_user-token' })
  })

  it('失敗しても例外を投げない（ログのみ）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
    const { revokeUserToken } = await import('./userAuth')
    await expect(revokeUserToken('gho_user-token')).resolves.toBeUndefined()
  })

  it('GitHub がエラー応答を返したら、ステータスだけをログに出す（トークンは出さない）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 401 })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { revokeUserToken } = await import('./userAuth')

    await expect(revokeUserToken('gho_user-token')).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    const loggedArgs = errorSpy.mock.calls.flat()
    expect(loggedArgs).toContain(401)
    expect(JSON.stringify(loggedArgs)).not.toContain('gho_user-token')
    errorSpy.mockRestore()
  })
})

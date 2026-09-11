import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/callback — GitHub App インストール後の戻り先。
 *
 * インストール完了時に、GitHub 側で利用者本人がそのインストールの持ち主であることを
 * 確認してから保存する。確認は次の順で行い、途中で条件を満たさなければ何も保存しない:
 *   1. state（署名・期限・利用者 ID）
 *   2. ログイン確認
 *   3. 二要素認証
 *   4. ログイン中の利用者と state の利用者 ID が一致するか
 *   5. その組織の owner か
 *   6. code の有無
 *   7. code を user-to-server トークンに交換できるか
 *   8. そのトークンで GET /user/installations に installation_id が含まれるか。
 *      含まれていても、個人アカウントならログイン中の GitHub アカウントと同じ ID か、
 *      組織アカウントならその組織の管理者（admin）かをさらに確認する
 *   9. 確認済みトークンの破棄
 *   10. 既存の紐づけが別の組織でないか
 *   11. 保存
 *
 * 回帰の背景（保存部分）: github_installations.created_by は auth.users への外部キーだが、
 * 以前は存在しない仮 ID（全部ゼロの UUID）を入れていたため insert が必ず失敗し、
 * GitHub 側ではインストール済みなのに AgentPM には保存されない状態になっていた
 * （組織設定に「連携する」ボタンが出続ける）。
 */

const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
const OTHER_ORG_ID = 'b21b48a1-7e39-4b39-9d0e-2a6e9b6b6f11'
const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'
const OTHER_USER_ID = '9b6e6b1f-3a8b-4f9a-8f3e-9c9b6a2b1a11'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const INSTALLATION_ID = 159612227
const GH_USER_ID = 900001
const GH_OTHER_USER_ID = 900002
const ORG_LOGIN = 'acme-corp'
const ORG_ACCOUNT_ID = 700001

let sessionUser: { id: string } | null
let membershipRole: string | null

const insertMock = vi.fn(() => Promise.resolve({ error: null }))
const upsertMock = vi.fn(() => Promise.resolve({ error: null }))

type UpdateCall = { patch: Record<string, unknown>; eqs: Array<[string, unknown]> }
let updateCalls: UpdateCall[]
const updateMock = vi.fn((patch: Record<string, unknown>) => {
  const call: UpdateCall = { patch, eqs: [] }
  updateCalls.push(call)
  const chain = {
    eq: vi.fn((col: string, value: unknown) => {
      call.eqs.push([col, value])
      return chain
    }),
    then: (onFulfilled: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(onFulfilled),
  }
  return chain
})

let existingInstallRow: { id: string; org_id: string } | null
let existingInstallError: { message: string } | null

const getInstallationPermissionsMock = vi.fn()
const getInstallationRepositoriesMock = vi.fn()

const exchangeCodeForUserTokenMock = vi.fn()
const findUserInstallationMock = vi.fn()
const getAuthenticatedGitHubUserMock = vi.fn()
const isOrgAdminMock = vi.fn()
const revokeUserTokenMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },
        getUser: vi.fn(() => Promise.resolve({ data: { user: sessionUser }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({ data: membershipRole ? { role: membershipRole } : null }),
                  ),
                })),
              })),
            })),
          }
        }
        return {}
      }),
    }),
  ),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'github_installations') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: existingInstallRow, error: existingInstallError })),
            })),
          })),
          insert: insertMock,
          update: updateMock,
        }
      }
      if (table === 'github_repositories') {
        return { upsert: upsertMock }
      }
      return {}
    }),
  })),
}))

vi.mock('@/lib/github', () => ({
  getInstallationRepositories: (...args: unknown[]) => getInstallationRepositoriesMock(...args),
  getInstallationPermissions: (...args: unknown[]) => getInstallationPermissionsMock(...args),
}))

vi.mock('@/lib/github/userAuth', () => ({
  exchangeCodeForUserToken: (...args: unknown[]) => exchangeCodeForUserTokenMock(...args),
  findUserInstallation: (...args: unknown[]) => findUserInstallationMock(...args),
  getAuthenticatedGitHubUser: (...args: unknown[]) => getAuthenticatedGitHubUserMock(...args),
  isOrgAdmin: (...args: unknown[]) => isOrgAdminMock(...args),
  revokeUserToken: (...args: unknown[]) => revokeUserTokenMock(...args),
}))

async function load() {
  vi.resetModules()
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'webhook-secret')
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'client-id-1')
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'client-secret-1')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
  const route = await import('@/app/api/github/callback/route')
  const config = await import('@/lib/github/config')
  return { GET: route.GET, createSignedState: config.createSignedState }
}

function req(opts: {
  installationId?: string | null
  state?: string | null
  code?: string | null
  setupAction?: string | null
} = {}) {
  const { installationId = String(INSTALLATION_ID), state, code = 'oauth-code-abc', setupAction = 'install' } = opts
  const params = new URLSearchParams()
  if (setupAction !== null) params.set('setup_action', setupAction)
  if (installationId !== null) params.set('installation_id', installationId)
  if (state !== null && state !== undefined) params.set('state', state)
  if (code !== null) params.set('code', code)
  return new NextRequest(`https://agentpm.app/api/github/callback?${params.toString()}`)
}

describe('GET /api/github/callback', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    insertMock.mockClear()
    upsertMock.mockClear()
    updateMock.mockClear()
    updateCalls = []
    getInstallationPermissionsMock.mockClear()
    getInstallationPermissionsMock.mockResolvedValue({ pull_requests: 'read', issues: 'write', metadata: 'read' })
    getInstallationRepositoriesMock.mockClear()
    getInstallationRepositoriesMock.mockResolvedValue([
      { id: 71585999, name: 'taskapp', owner: { login: 'yuta090', type: 'User' }, private: false, default_branch: 'main' },
    ])
    exchangeCodeForUserTokenMock.mockClear()
    exchangeCodeForUserTokenMock.mockResolvedValue('user-token-abc')
    findUserInstallationMock.mockClear()
    findUserInstallationMock.mockResolvedValue({
      id: INSTALLATION_ID,
      account: { id: GH_USER_ID, login: 'yuta090', type: 'User' },
    })
    getAuthenticatedGitHubUserMock.mockClear()
    getAuthenticatedGitHubUserMock.mockResolvedValue({ id: GH_USER_ID, login: 'yuta090' })
    isOrgAdminMock.mockClear()
    isOrgAdminMock.mockResolvedValue(true)
    revokeUserTokenMock.mockClear()
    revokeUserTokenMock.mockResolvedValue(undefined)
    sessionUser = { id: USER_ID }
    membershipRole = 'owner'
    existingInstallRow = null
    existingInstallError = null
  })

  it('owner・本人確認とも通れば、ログイン中のユーザーを created_by に入れて保存し成功で戻す', async () => {
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).toHaveBeenCalledTimes(1)
    const payload = (insertMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(payload.created_by).toBe(USER_ID)
    expect(payload.created_by).not.toBe(ZERO_UUID)
    expect(payload).toMatchObject({ org_id: ORG_ID, installation_id: INSTALLATION_ID, account_login: 'yuta090', account_type: 'User' })
    // user-to-server トークンはどこにも保存しない
    expect(payload).not.toHaveProperty('access_token')
    expect(payload).not.toHaveProperty('token_expires_at')
    // insert/update/upsert に渡した引数のどこにも、確認に使ったトークン文字列そのものが含まれない
    const allWriteArgs = JSON.stringify([
      ...insertMock.mock.calls,
      ...updateMock.mock.calls,
      ...upsertMock.mock.calls,
    ])
    expect(allWriteArgs).not.toContain('user-token-abc')

    expect(exchangeCodeForUserTokenMock).toHaveBeenCalledWith('oauth-code-abc')
    expect(findUserInstallationMock).toHaveBeenCalledWith('user-token-abc', INSTALLATION_ID)
    // 個人アカウントの照合はログイン中の GitHub アカウントとの一致確認、組織の管理者確認は呼ばない
    expect(getAuthenticatedGitHubUserMock).toHaveBeenCalledWith('user-token-abc')
    expect(isOrgAdminMock).not.toHaveBeenCalled()
    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/settings/org-integrations')
    expect(location.searchParams.get('github')).toBe('connected')
    // 旧形式（error= / success=）は出ない。結果は github= だけに一本化する
    expect(location.searchParams.has('error')).toBe(false)
    expect(location.searchParams.has('success')).toBe(false)
  })

  it('state に戻り先が無ければ、既定は設定画面（/settings/org-integrations）', async () => {
    const { GET, createSignedState } = await load()
    // redirectUri を空にして「state に戻り先が無い」状態を作る
    const state = createSignedState(ORG_ID, '', USER_ID)
    const res = await GET(req({ state }))

    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/settings/org-integrations')
    expect(location.searchParams.get('github')).toBe('connected')
  })

  it('利用者 ID の入っていない state（古い形式）は無効', async () => {
    const { GET } = await load()
    // config.test.ts と同じ手順で、sub の無い旧形式 state を組み立てる
    const { createHmac } = await import('node:crypto')
    const payload = JSON.stringify({ orgId: ORG_ID, redirectUri: '/settings/org-integrations', ts: Date.now() })
    const signature = createHmac('sha256', 'webhook-secret').update(payload).digest('hex')
    const legacyState = Buffer.from(JSON.stringify({ payload, signature }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const res = await GET(req({ state: legacyState }))

    expect(insertMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('invalid_state')
  })

  it('未ログインなら保存せずにエラーで戻す（仮ユーザーで保存しない）', async () => {
    const { GET, createSignedState } = await load()
    sessionUser = null
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('unauthorized')
  })

  it('インストールを始めた利用者とログイン中の利用者が異なれば保存しない', async () => {
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', OTHER_USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(exchangeCodeForUserTokenMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('state_mismatch')
  })

  it('その組織の owner でなければ保存しない', async () => {
    const { GET, createSignedState } = await load()
    membershipRole = 'member'
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(exchangeCodeForUserTokenMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('forbidden')
  })

  it('code が無ければ保存しない（新規インストール）', async () => {
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state, code: null }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(exchangeCodeForUserTokenMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('oauth_required')
  })

  it('code が無ければ保存しない（既存インストールの更新でも同じ検査を通す）', async () => {
    existingInstallRow = { id: 'install-row-1', org_id: ORG_ID }
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state, code: null }))

    expect(updateMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('oauth_required')
  })

  it('code をトークンに交換できなければ保存しない', async () => {
    exchangeCodeForUserTokenMock.mockResolvedValueOnce(null)
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(findUserInstallationMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('oauth_failed')
  })

  it('利用者のインストール一覧に installation_id が無ければ保存しない', async () => {
    findUserInstallationMock.mockResolvedValueOnce(null)
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    // この時点までは App の資格情報でのリポジトリ取得・許可範囲取得・リポジトリ保存を呼ばない
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    expect(getInstallationPermissionsMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('installation_not_accessible')
  })

  it('個人アカウントのインストールで、ログイン中の GitHub アカウントと id が一致しなければ保存しない', async () => {
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: GH_OTHER_USER_ID, login: 'someone-else', type: 'User' },
    })
    getAuthenticatedGitHubUserMock.mockResolvedValueOnce({ id: GH_USER_ID, login: 'yuta090' })
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('installation_not_owned')
  })

  it('ログイン中の GitHub アカウント（/user）が取得できなければ、持ち主ではないではなく一時的な失敗として戻す', async () => {
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: GH_USER_ID, login: 'yuta090', type: 'User' },
    })
    getAuthenticatedGitHubUserMock.mockResolvedValueOnce(null)
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('api_error')
  })

  it('User / Organization 以外の account.type（例: Enterprise）は持ち主として扱わない', async () => {
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: 123, login: '', type: 'Enterprise' },
    })
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(isOrgAdminMock).not.toHaveBeenCalled()
    expect(getAuthenticatedGitHubUserMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('installation_not_owned')
  })

  it('組織アカウントで account.login が空文字なら、isOrgAdmin を呼ばず持ち主として扱わない', async () => {
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: ORG_ACCOUNT_ID, login: '', type: 'Organization' },
    })
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(isOrgAdminMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('installation_not_owned')
  })

  it.each([
    ['role が admin 以外（member）', false],
    ['404（非所属）', false],
    ['403（許可の承認前）', false],
    ['state=pending（承認待ち）', false],
  ])('組織アカウントで %s なら保存しない', async (_label, isAdmin) => {
    // isOrgAdmin 自体の判定（member/404/403/pending の分岐）は userAuth.test.ts で確認済み。
    // ここでは callback がその結果を installation_not_owned に正しく変換することを確認する
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: ORG_ACCOUNT_ID, login: ORG_LOGIN, type: 'Organization' },
    })
    isOrgAdminMock.mockResolvedValueOnce(isAdmin)
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('installation_not_owned')
  })

  it('組織アカウントで role=admin かつ state=active（isOrgAdmin が true）なら保存される', async () => {
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: ORG_ACCOUNT_ID, login: ORG_LOGIN, type: 'Organization' },
    })
    isOrgAdminMock.mockResolvedValueOnce(true)
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(isOrgAdminMock).toHaveBeenCalledWith('user-token-abc', ORG_LOGIN)
    expect(getAuthenticatedGitHubUserMock).not.toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalledTimes(1)
    const payload = (insertMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    // account_login / account_type は、見つかった項目の account から入る
    expect(payload).toMatchObject({ account_login: ORG_LOGIN, account_type: 'Organization' })
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('connected')
  })

  it('account_login / account_type は、見つかったインストール項目の account から入る（リポジトリの owner ではない）', async () => {
    findUserInstallationMock.mockResolvedValueOnce({
      id: INSTALLATION_ID,
      account: { id: GH_USER_ID, login: 'yuta090', type: 'User' },
    })
    // リポジトリの owner は別のログイン名（Organization のリポジトリを個人が閲覧できるケース等）
    getInstallationRepositoriesMock.mockResolvedValueOnce([
      { id: 1, name: 'some-repo', owner: { login: 'not-the-account-login', type: 'Organization' }, private: false, default_branch: 'main' },
    ])
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    await GET(req({ state }))

    const payload = (insertMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(payload).toMatchObject({ account_login: 'yuta090', account_type: 'User' })
  })

  it('確認が失敗しても、確認済みのトークンは必ず破棄する（finally）', async () => {
    findUserInstallationMock.mockRejectedValueOnce(new Error('network error'))
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')
    expect(insertMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('api_error')
  })

  it('トークンの破棄に失敗しても、確認が通っていれば成功で戻す', async () => {
    revokeUserTokenMock.mockRejectedValueOnce(new Error('revoke failed'))
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)

    const res = await GET(req({ state }))

    expect(revokeUserTokenMock).toHaveBeenCalledWith('user-token-abc')
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('connected')
  })

  it('既存の紐づけの検索に失敗したら、保存に進まずエラーで戻す', async () => {
    existingInstallError = { message: 'connection error' }
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    // DB エラーの時点で打ち切り、App の資格情報でのリポジトリ取得には進まない
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('api_error')
  })

  it('既存の紐づけが別の組織であれば、検査に通っても付け替えない', async () => {
    existingInstallRow = { id: 'install-row-1', org_id: OTHER_ORG_ID }
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    expect(getInstallationRepositoriesMock).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('already_linked')
  })

  it('既存の紐づけが同じ組織なら更新する', async () => {
    existingInstallRow = { id: 'install-row-1', org_id: ORG_ID }
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(insertMock).not.toHaveBeenCalled()
    const accountUpdate = updateCalls.find((c) => 'account_login' in c.patch)
    expect(accountUpdate?.eqs).toContainEqual(['id', 'install-row-1'])
    // 更新では created_by・org_id は変えない（付け替え・作成者の書き換えをしない）
    expect(accountUpdate?.patch).not.toHaveProperty('created_by')
    expect(accountUpdate?.patch).not.toHaveProperty('org_id')
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('connected')
  })

  it('インストール完了時に、その時点の許可範囲を github_installations.permissions に保存する', async () => {
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    const res = await GET(req({ state }))

    expect(res.status).toBe(307)
    expect(getInstallationPermissionsMock).toHaveBeenCalledWith(INSTALLATION_ID)
    const permissionsUpdate = updateCalls.find((c) => 'permissions' in c.patch)
    expect(permissionsUpdate?.patch).toMatchObject({
      permissions: { pull_requests: 'read', issues: 'write', metadata: 'read' },
    })
    expect(typeof permissionsUpdate?.patch.permissions_updated_at).toBe('string')
    expect(permissionsUpdate?.eqs).toContainEqual(['org_id', ORG_ID])
    expect(permissionsUpdate?.eqs).toContainEqual(['installation_id', INSTALLATION_ID])
  })

  // state は署名済みなので通常はここに危険な値が来ないが、戻り先の検査は
  // 一か所（isSafeInternalPath）に揃えておき、万一 state の中身が想定と違っても
  // サイト外へは絶対にリダイレクトしない。
  it('state の戻り先がサイト内パスでなければ既定の戻り先にする', async () => {
    const { GET, createSignedState } = await load()
    const res = await GET(req('159612227', createSignedState(ORG_ID, 'https://evil.example/x')))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('https://agentpm.app')
    expect(location.pathname).toBe('/settings/org-integrations')
  })

  it('state の戻り先に制御文字が入っていれば既定の戻り先にする', async () => {
    const { GET, createSignedState } = await load()
    const res = await GET(req('159612227', createSignedState(ORG_ID, '/\t/evil.example')))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('https://agentpm.app')
    expect(location.pathname).toBe('/settings/org-integrations')
  })

  it('許可範囲の取得・保存に失敗しても、インストール自体は成功のまま止まらない（列未追加のマイグレーション未適用に備える）', async () => {
    getInstallationPermissionsMock.mockRejectedValueOnce(new Error('column "permissions" does not exist'))
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)

    const res = await GET(req({ state }))

    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('github')).toBe('connected')
  })

  it('入口のログに installation_id・state・code の値そのものは出さない（付いていたかどうかだけ）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { GET, createSignedState } = await load()
    const state = createSignedState(ORG_ID, '/settings/org-integrations', USER_ID)
    await GET(req({ state, setupAction: 'update' }))

    expect(infoSpy).toHaveBeenCalled()
    const loggedText = JSON.stringify(infoSpy.mock.calls)
    expect(loggedText).not.toContain(String(INSTALLATION_ID))
    expect(loggedText).not.toContain(state)
    expect(loggedText).not.toContain('oauth-code-abc')
    // 値ではなく、付いていたかどうか・setup_action の区分だけを残す
    expect(loggedText).toContain('has_installation_id')
    expect(loggedText).toContain('has_state')
    expect(loggedText).toContain('has_code')
    expect(loggedText).toContain('update')

    infoSpy.mockRestore()
  })
})

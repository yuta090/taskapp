import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/callback — GitHub App インストール後の戻り先。
 *
 * 回帰の背景: github_installations.created_by は auth.users への外部キーだが、
 * 以前は存在しない仮 ID（全部ゼロの UUID）を入れていたため insert が必ず失敗し、
 * GitHub 側ではインストール済みなのに AgentPM には保存されない状態になっていた
 * （組織設定に「連携する」ボタンが出続ける）。
 */

const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

let sessionUser: { id: string } | null
const insertMock = vi.fn(() => Promise.resolve({ error: null }))
const upsertMock = vi.fn(() => Promise.resolve({ error: null }))

let permissionsUpdateError: { message: string } | null = null
let permissionsUpdatePatch: Record<string, unknown> | null = null
const permissionsUpdateEqCalls: Array<[string, unknown]> = []
const permissionsUpdateMock = vi.fn((patch: Record<string, unknown>) => {
  permissionsUpdatePatch = patch
  return {
    eq: vi.fn((col: string, value: unknown) => {
      permissionsUpdateEqCalls.push([col, value])
      return {
        eq: vi.fn((col2: string, value2: unknown) => {
          permissionsUpdateEqCalls.push([col2, value2])
          return Promise.resolve({ error: permissionsUpdateError })
        }),
      }
    }),
  }
})
const getInstallationPermissionsMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },  getUser: vi.fn(() => Promise.resolve({ data: { user: sessionUser }, error: null })) },
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
              eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
            })),
          })),
          insert: insertMock,
          update: permissionsUpdateMock,
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
  getInstallationRepositories: vi.fn(() =>
    Promise.resolve([
      { id: 71585999, name: 'taskapp', owner: { login: 'yuta090', type: 'User' }, private: false, default_branch: 'main' },
    ]),
  ),
  getInstallationPermissions: (...args: unknown[]) => getInstallationPermissionsMock(...args),
}))

async function load() {
  vi.resetModules()
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'webhook-secret')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
  const route = await import('@/app/api/github/callback/route')
  const config = await import('@/lib/github/config')
  return { GET: route.GET, createSignedState: config.createSignedState }
}

function req(installationId: string, state: string) {
  return new NextRequest(
    `https://agentpm.app/api/github/callback?installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}`,
  )
}

describe('GET /api/github/callback', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    insertMock.mockClear()
    upsertMock.mockClear()
    permissionsUpdateMock.mockClear()
    getInstallationPermissionsMock.mockClear()
    getInstallationPermissionsMock.mockResolvedValue({ pull_requests: 'read', issues: 'write', metadata: 'read' })
    permissionsUpdateError = null
    permissionsUpdatePatch = null
    permissionsUpdateEqCalls.length = 0
    sessionUser = { id: USER_ID }
  })

  it('ログイン中のユーザーを created_by に入れて保存し、成功で戻す', async () => {
    const { GET, createSignedState } = await load()
    const res = await GET(req('159612227', createSignedState(ORG_ID, '/settings/org-integrations')))

    expect(insertMock).toHaveBeenCalledTimes(1)
    const payload = (insertMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(payload.created_by).toBe(USER_ID)
    expect(payload.created_by).not.toBe(ZERO_UUID)
    expect(payload).toMatchObject({ org_id: ORG_ID, installation_id: 159612227, account_login: 'yuta090', account_type: 'User' })

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/settings/org-integrations')
    expect(location.searchParams.get('success')).toBe('true')
  })

  it('未ログインなら保存せずにエラーで戻す（仮ユーザーで保存しない）', async () => {
    const { GET, createSignedState } = await load()
    sessionUser = null
    const res = await GET(req('159612227', createSignedState(ORG_ID, '/settings/org-integrations')))

    expect(insertMock).not.toHaveBeenCalled()
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('error')).toBe('unauthorized')
  })

  it('インストール完了時に、その時点の許可範囲を github_installations.permissions に保存する', async () => {
    const { GET, createSignedState } = await load()
    const res = await GET(req('159612227', createSignedState(ORG_ID, '/settings/org-integrations')))

    expect(res.status).toBe(307)
    expect(getInstallationPermissionsMock).toHaveBeenCalledWith(159612227)
    expect(permissionsUpdateMock).toHaveBeenCalledTimes(1)
    expect(permissionsUpdatePatch).toMatchObject({
      permissions: { pull_requests: 'read', issues: 'write', metadata: 'read' },
    })
    expect(typeof permissionsUpdatePatch?.permissions_updated_at).toBe('string')
    expect(permissionsUpdateEqCalls).toContainEqual(['org_id', ORG_ID])
    expect(permissionsUpdateEqCalls).toContainEqual(['installation_id', 159612227])
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

    const res = await GET(req('159612227', createSignedState(ORG_ID, '/settings/org-integrations')))

    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('success')).toBe('true')
  })
})

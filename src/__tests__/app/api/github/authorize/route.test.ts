import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/authorize — GitHub App インストール URL をサーバー側で組み立ててリダイレクトする。
 *
 * 回帰の背景: 以前はクライアントコンポーネントが getGitHubInstallUrl() を直接呼んでいたため、
 * ブラウザでは GITHUB_APP_SLUG が見えず既定値 'taskapp' の 404 URL になり、
 * さらに state の HMAC が空鍵で署名されてコールバック側の検証も必ず失敗していた。
 */

const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
const mockUser = { id: 'user-1' }

let authResponse: { data: { user: typeof mockUser | null }; error: { message: string } | null }
let membershipResponse: { data: { role: string } | null }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },  getUser: vi.fn(() => Promise.resolve(authResponse)) },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(membershipResponse)),
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

const ENV = {
  GITHUB_APP_ID: '4853890',
  GITHUB_APP_CLIENT_ID: 'Iv23li_test',
  GITHUB_APP_CLIENT_SECRET: 'client-secret',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\ntest\\n-----END RSA PRIVATE KEY-----',
  GITHUB_WEBHOOK_SECRET: 'webhook-secret',
  GITHUB_APP_SLUG: 'agentpm-for-github',
}

async function loadRoute(env: Record<string, string> = ENV) {
  vi.resetModules()
  for (const k of Object.keys(ENV)) vi.stubEnv(k, '')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const route = await import('@/app/api/github/authorize/route')
  const config = await import('@/lib/github/config')
  return { GET: route.GET, verifySignedState: config.verifySignedState }
}

function req(query: string) {
  return new NextRequest(`http://localhost:4000/api/github/authorize${query}`)
}

describe('GET /api/github/authorize', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    authResponse = { data: { user: mockUser }, error: null }
    membershipResponse = { data: { role: 'owner' } }
  })

  it('未ログインは 401', async () => {
    const { GET } = await loadRoute()
    authResponse = { data: { user: null }, error: { message: 'no session' } }
    const res = await GET(req(`?orgId=${ORG_ID}`))
    expect(res.status).toBe(401)
  })

  it('orgId が無いと 400', async () => {
    const { GET } = await loadRoute()
    const res = await GET(req(''))
    expect(res.status).toBe(400)
  })

  it('owner 以外は 403', async () => {
    const { GET } = await loadRoute()
    membershipResponse = { data: { role: 'member' } }
    const res = await GET(req(`?orgId=${ORG_ID}`))
    expect(res.status).toBe(403)
  })

  it('GitHub App が未設定なら 503', async () => {
    const { GET } = await loadRoute({ ...ENV, GITHUB_APP_PRIVATE_KEY: '' })
    const res = await GET(req(`?orgId=${ORG_ID}`))
    expect(res.status).toBe(503)
  })

  it('owner なら本番 slug のインストール URL へ、サーバー鍵で署名した state 付きでリダイレクトする', async () => {
    const { GET, verifySignedState } = await loadRoute()
    const res = await GET(req(`?orgId=${ORG_ID}`))
    expect(res.status).toBe(307)

    const location = new URL(res.headers.get('location')!)
    expect(location.origin + location.pathname).toBe(
      'https://github.com/apps/agentpm-for-github/installations/new',
    )
    // 既定値 'taskapp' に落ちていないこと（404 の原因）
    expect(location.pathname).not.toContain('/apps/taskapp/')

    const state = location.searchParams.get('state')!
    const verified = verifySignedState(state)
    expect(verified).toEqual({ orgId: ORG_ID, redirectUri: '/settings/org-integrations' })
  })

  it('redirect はサイト内パスのみ受け付け、外部 URL は既定に置き換える', async () => {
    const { GET, verifySignedState } = await loadRoute()

    const ok = await GET(req(`?orgId=${ORG_ID}&redirect=%2Fsettings%2Fintegrations%2Fgithub`))
    const okState = new URL(ok.headers.get('location')!).searchParams.get('state')!
    expect(verifySignedState(okState)?.redirectUri).toBe('/settings/integrations/github')

    const bad = await GET(req(`?orgId=${ORG_ID}&redirect=https%3A%2F%2Fevil.example%2Fx`))
    const badState = new URL(bad.headers.get('location')!).searchParams.get('state')!
    expect(verifySignedState(badState)?.redirectUri).toBe('/settings/org-integrations')

    const protocolRelative = await GET(req(`?orgId=${ORG_ID}&redirect=%2F%2Fevil.example`))
    const prState = new URL(protocolRelative.headers.get('location')!).searchParams.get('state')!
    expect(verifySignedState(prState)?.redirectUri).toBe('/settings/org-integrations')
  })

  it('制御文字を含む戻り先も既定に置き換える', async () => {
    const { GET, verifySignedState } = await loadRoute()

    // %09 はタブ（制御文字）
    const withTab = await GET(req(`?orgId=${ORG_ID}&redirect=%2F%09%2Fevil.example`))
    const tabState = new URL(withTab.headers.get('location')!).searchParams.get('state')!
    expect(verifySignedState(tabState)?.redirectUri).toBe('/settings/org-integrations')
  })
})

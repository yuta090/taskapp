import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'

/**
 * middleware のリダイレクト判定。
 *
 * ログイン後の着地は LoginClient / auth/callback / middleware の3箇所で
 * 判定されるが、判定結果は一致していなければならない:
 * - 組織未所属 → /onboarding（Step1: 組織作成）
 * - 組織あり・プロジェクト無し → /onboarding（Step2: テンプレート選択から再開）
 * - 組織・プロジェクトあり → 最初のプロジェクト
 * middleware だけが古い /inbox フォールバックを持つと、他の2箇所が
 * /onboarding に送っても middleware が先回りして /inbox に弾いてしまう。
 */

let membershipResponse: { org_id: string; role: string } | null
let spaceResponse: { data: { id: string } | null }
let vendorResponse: { data: { id: string } | null }
let userResponse: { data: { user: { id: string } | null } }
let sessionResponse: { data: { session: { user: { id: string } } | null } }

vi.mock('@/lib/org/resolveActiveOrg', () => ({
  resolveActiveOrg: vi.fn(() => Promise.resolve(membershipResponse)),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve(userResponse)),
      getSession: vi.fn(() => Promise.resolve(sessionResponse)),
    },
    from: (table: string) => {
      if (table === 'space_memberships') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => Promise.resolve(vendorResponse)),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve(spaceResponse)),
      }
    },
  }),
}))

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:4000${path}`)
}

function redirectPath(response: Response): string | null {
  const location = response.headers.get('location')
  return location ? new URL(location).pathname : null
}

describe('middleware — ログイン済みユーザーの /login・/signup アクセス', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    userResponse = { data: { user: { id: 'user-1' } } }
    sessionResponse = { data: { session: { user: { id: 'user-1' } } } }
    membershipResponse = null
    spaceResponse = { data: null }
    vendorResponse = { data: null }
  })

  it('組織未所属なら /onboarding へ（/inbox の空画面に落とさない）', async () => {
    membershipResponse = null

    const response = await middleware(makeRequest('/login'))

    expect(redirectPath(response)).toBe('/onboarding')
  })

  it('組織はあるがプロジェクトが無ければ /onboarding へ（Step2から再開）', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: null }

    const response = await middleware(makeRequest('/signup'))

    expect(redirectPath(response)).toBe('/onboarding')
  })

  it('組織もプロジェクトもあれば最初のプロジェクトへ', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await middleware(makeRequest('/login'))

    expect(redirectPath(response)).toBe('/org-1/project/space-1')
  })

  it('clientロールは /portal へ', async () => {
    membershipResponse = { org_id: 'org-1', role: 'client' }

    const response = await middleware(makeRequest('/login'))

    expect(redirectPath(response)).toBe('/portal')
  })

  it('redirect パラメータがあれば（検証の上）そこへ復帰（招待ログインリンク等）', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await middleware(makeRequest('/login?redirect=%2Finvite%2Fabc'))

    expect(redirectPath(response)).toBe('/invite/abc')
  })

  it('不正な redirect パラメータ（// 始まり）は無視して既定の着地へ', async () => {
    membershipResponse = null

    const response = await middleware(makeRequest('/login?redirect=//evil.com'))

    expect(redirectPath(response)).toBe('/onboarding')
  })
})

describe('middleware — /onboarding ガード', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    userResponse = { data: { user: { id: 'user-1' } } }
    sessionResponse = { data: { session: { user: { id: 'user-1' } } } }
    membershipResponse = null
    spaceResponse = { data: null }
    vendorResponse = { data: null }
  })

  it('組織はあるがプロジェクトが無ければ通す（Step2再開を /inbox に弾かない）', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: null }

    const response = await middleware(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBeNull()
  })

  it('組織もプロジェクトもあればプロジェクトへリダイレクト', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await middleware(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBe('/org-1/project/space-1')
  })

  it('組織未所属なら通す（Step1: 組織作成）', async () => {
    membershipResponse = null

    const response = await middleware(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBeNull()
  })

  it('未認証なら /login へ', async () => {
    userResponse = { data: { user: null } }

    const response = await middleware(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBe('/login')
  })
})

describe('middleware — 保護パスの未認証ガード（回帰）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    userResponse = { data: { user: null } }
    sessionResponse = { data: { session: null } }
    membershipResponse = null
    spaceResponse = { data: null }
    vendorResponse = { data: null }
  })

  it('未認証で保護パスにアクセスすると /login?redirect= へ', async () => {
    const response = await middleware(makeRequest('/inbox'))

    const location = response.headers.get('location')
    expect(location).not.toBeNull()
    const url = new URL(location!)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('redirect')).toBe('/inbox')
  })

  it('公開パスは未認証でも通す', async () => {
    const response = await middleware(makeRequest('/pricing'))

    expect(redirectPath(response)).toBeNull()
  })

  // 本番で /tokushoho・/features 等がログイン必須になっていた回帰。
  // 特商法表示は法令上、購入前の誰もが閲覧できる必要がある。
  // マーケティング・ヘルプページも未認証で見られなければ集客・サポートが成立しない。
  it('公開すべきマーケティング・法務・ヘルプページは未認証で通す', async () => {
    const paths = [
      '/tokushoho',
      '/terms',
      '/privacy',
      '/features',
      '/compare',
      '/use-cases',
      '/company',
      '/help',
      '/help/client',
    ]
    for (const path of paths) {
      const response = await middleware(makeRequest(path))
      expect(redirectPath(response), path).toBeNull()
    }
  })

  it('静的LP /lp1 は未認証でも通す（rewrite先はpublic/lp1/index.html）', async () => {
    const response = await middleware(makeRequest('/lp1'))

    expect(redirectPath(response)).toBeNull()
  })

  it('静的LP /lp2 以降も番号付きLPは未認証で通す', async () => {
    for (const path of ['/lp2', '/lp3', '/lp12']) {
      const response = await middleware(makeRequest(path))
      expect(redirectPath(response), path).toBeNull()
    }
  })

  it('/lp（番号なし）や /lpx は公開扱いにしない', async () => {
    for (const path of ['/lp', '/lpx', '/lp1abc']) {
      const response = await middleware(makeRequest(path))
      expect(redirectPath(response), path).toBe('/login')
    }
  })

  it('未認証で保護パス（クエリ付き）にアクセスすると redirect にクエリ文字列も保持する', async () => {
    const response = await middleware(makeRequest('/inbox?task=123&foo=bar'))

    const location = response.headers.get('location')
    expect(location).not.toBeNull()
    const url = new URL(location!)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('redirect')).toBe('/inbox?task=123&foo=bar')
  })
})

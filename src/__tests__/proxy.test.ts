import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../proxy'

/**
 * proxy（旧 middleware）のリダイレクト判定。
 *
 * ログイン後の着地は LoginClient / auth/callback / proxy の3箇所で
 * 判定されるが、判定結果は一致していなければならない:
 * - 組織未所属 → /onboarding（Step1: 組織作成）
 * - 組織あり・プロジェクト無し → /onboarding（Step2: テンプレート選択から再開）
 * - 組織・プロジェクトあり → 最初のプロジェクト
 * proxy だけが古い /inbox フォールバックを持つと、他の2箇所が
 * /onboarding に送っても proxy が先回りして /inbox に弾いてしまう。
 */

let membershipResponse: { org_id: string; role: string } | null
let spaceResponse: { data: { id: string } | null }
let vendorResponse: { data: { id: string } | null }
let userResponse: { data: { user: { id: string } | null } }
let sessionResponse: { data: { session: { user: { id: string } } | null } }

vi.mock('@/lib/org/resolveActiveOrg', () => ({
  resolveActiveOrg: vi.fn(() => Promise.resolve(membershipResponse)),
}))

/** セッション更新を模す: getSession のたびに Supabase が setAll で auth cookie を書き直す */
let refreshedCookieOnSession: { name: string; value: string } | null = null
/** 二要素認証の段階（currentLevel=いま / nextLevel=到達すべき段階。登録済みなら aal2） */
let aalResponse: { data: { currentLevel: 'aal1' | 'aal2' | null; nextLevel: 'aal1' | 'aal2' | null } | null } = { data: { currentLevel: 'aal1', nextLevel: 'aal1' } }

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: Array<{ name: string; value: string; options?: object }>) => void } },
  ) => ({
    auth: {
      getUser: vi.fn(() => {
        if (refreshedCookieOnSession) {
          opts.cookies.setAll([{ ...refreshedCookieOnSession, options: { path: '/' } }])
        }
        return Promise.resolve(userResponse)
      }),
      getSession: vi.fn(() => {
        if (refreshedCookieOnSession) {
          opts.cookies.setAll([{ ...refreshedCookieOnSession, options: { path: '/' } }])
        }
        return Promise.resolve(sessionResponse)
      }),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve(aalResponse)),
      },
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

describe('proxy — ログイン済みユーザーの /login・/signup アクセス', () => {
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

    const response = await proxy(makeRequest('/login'))

    expect(redirectPath(response)).toBe('/onboarding')
  })

  it('組織はあるがプロジェクトが無ければ /onboarding へ（Step2から再開）', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: null }

    const response = await proxy(makeRequest('/signup'))

    expect(redirectPath(response)).toBe('/onboarding')
  })

  it('組織もプロジェクトもあれば最初のプロジェクトへ', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await proxy(makeRequest('/login'))

    expect(redirectPath(response)).toBe('/org-1/project/space-1')
  })

  it('clientロールは /portal へ', async () => {
    membershipResponse = { org_id: 'org-1', role: 'client' }

    const response = await proxy(makeRequest('/login'))

    expect(redirectPath(response)).toBe('/portal')
  })

  it('redirect パラメータがあれば（検証の上）そこへ復帰（招待ログインリンク等）', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await proxy(makeRequest('/login?redirect=%2Finvite%2Fabc'))

    expect(redirectPath(response)).toBe('/invite/abc')
  })

  it('不正な redirect パラメータ（// 始まり）は無視して既定の着地へ', async () => {
    membershipResponse = null

    const response = await proxy(makeRequest('/login?redirect=//evil.com'))

    expect(redirectPath(response)).toBe('/onboarding')
  })
})

describe('proxy — /onboarding ガード', () => {
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

    const response = await proxy(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBeNull()
  })

  it('組織もプロジェクトもあればプロジェクトへリダイレクト', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await proxy(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBe('/org-1/project/space-1')
  })

  it('組織未所属なら通す（Step1: 組織作成）', async () => {
    membershipResponse = null

    const response = await proxy(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBeNull()
  })

  it('未認証なら /login へ', async () => {
    userResponse = { data: { user: null } }

    const response = await proxy(makeRequest('/onboarding'))

    expect(redirectPath(response)).toBe('/login')
  })
})

describe('proxy — 保護パスの未認証ガード（回帰）', () => {
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
    const response = await proxy(makeRequest('/inbox'))

    const location = response.headers.get('location')
    expect(location).not.toBeNull()
    const url = new URL(location!)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('redirect')).toBe('/inbox')
  })

  it('公開パスは未認証でも通す', async () => {
    const response = await proxy(makeRequest('/pricing'))

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
      const response = await proxy(makeRequest(path))
      expect(redirectPath(response), path).toBeNull()
    }
  })

  it('静的LP /lp1 は未認証でも通す（rewrite先はpublic/lp1/index.html）', async () => {
    const response = await proxy(makeRequest('/lp1'))

    expect(redirectPath(response)).toBeNull()
  })

  it('静的LP /lp2 以降も番号付きLPは未認証で通す', async () => {
    for (const path of ['/lp2', '/lp3', '/lp12']) {
      const response = await proxy(makeRequest(path))
      expect(redirectPath(response), path).toBeNull()
    }
  })

  it('/lp（番号なし）や /lpx は公開扱いにしない', async () => {
    for (const path of ['/lp', '/lpx', '/lp1abc']) {
      const response = await proxy(makeRequest(path))
      expect(redirectPath(response), path).toBe('/login')
    }
  })

  it('未認証で保護パス（クエリ付き）にアクセスすると redirect にクエリ文字列も保持する', async () => {
    const response = await proxy(makeRequest('/inbox?task=123&foo=bar'))

    const location = response.headers.get('location')
    expect(location).not.toBeNull()
    const url = new URL(location!)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('redirect')).toBe('/inbox?task=123&foo=bar')
  })
})

describe('proxy — 流入経路の first-touch cookie', () => {
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

  it('utm 付きで公開ページ（静的LP）に来たら cookie を置く', async () => {
    const response = await proxy(makeRequest('/lp1?utm_source=google&utm_medium=cpc'))

    const cookie = response.cookies.get('agentpm_ft')
    expect(cookie).toBeDefined()
    // cookies.get は復号済みの値を返す＝JSON そのもの（Set-Cookie ヘッダ上では1回だけ符号化される）
    const decoded = JSON.parse(cookie!.value)
    expect(decoded.utm_source).toBe('google')
    expect(decoded.landing_path).toBe('/lp1')
    expect(cookie!.path).toBe('/')
    const header = response.headers.get('set-cookie') ?? ''
    const rawValue = header.match(/agentpm_ft=([^;]+)/)?.[1] ?? ''
    expect(rawValue.startsWith('%7B')).toBe(true)
    expect(JSON.parse(decodeURIComponent(rawValue)).utm_source).toBe('google')
  })

  it('保護ページへ未ログインで来て /login に飛ばすときも cookie は付く', async () => {
    const response = await proxy(makeRequest('/inbox?ref=task6&art=line-group-tasks'))

    expect(redirectPath(response)).toBe('/login')
    expect(response.cookies.get('agentpm_ft')).toBeDefined()
  })

  it('既に cookie があれば上書きしない（first-touch）', async () => {
    const request = new NextRequest('http://localhost:4000/lp1?utm_source=new', {
      headers: { cookie: 'agentpm_ft=old' },
    })
    const response = await proxy(request)

    expect(response.cookies.get('agentpm_ft')).toBeUndefined()
  })

  it('手がかりが無い訪問では cookie を置かない', async () => {
    const response = await proxy(makeRequest('/lp1'))

    expect(response.cookies.get('agentpm_ft')).toBeUndefined()
  })
})

describe('proxy — first-touch cookie と Supabase のセッション cookie 更新が共存する', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    userResponse = { data: { user: { id: 'user-1' } } }
    sessionResponse = { data: { session: { user: { id: 'user-1' } } } }
    vendorResponse = { data: null }
    refreshedCookieOnSession = { name: 'sb-auth-token', value: 'refreshed' }
  })

  afterEach(() => {
    refreshedCookieOnSession = null
  })

  it('通常レスポンスで、更新された auth cookie と agentpm_ft の両方が付く', async () => {
    membershipResponse = { org_id: 'org-1', role: 'owner' }
    spaceResponse = { data: { id: 'space-1' } }

    const response = await proxy(makeRequest('/org-1/project/space-1?utm_source=google&utm_medium=cpc'))

    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('sb-auth-token')?.value).toBe('refreshed')
    expect(response.cookies.get('agentpm_ft')).toBeDefined()
  })

  it('リダイレクトレスポンスにも agentpm_ft が付く（既存のリダイレクト判定は変えない）', async () => {
    membershipResponse = null

    // ログイン済みで /login に来た → 組織未所属なので /onboarding へ（既存の判定）
    const response = await proxy(makeRequest('/login?utm_source=google'))

    expect(redirectPath(response)).toBe('/onboarding')
    expect(response.cookies.get('agentpm_ft')).toBeDefined()
    // 注: 既存実装ではリダイレクト用レスポンスを新規に作るため、setAll で更新された auth cookie は
    // リダイレクトには載らない（first-touch 追加前からの挙動・本テストの対象外）。
  })

  describe('二要素認証の門番', () => {
    beforeEach(() => {
      sessionResponse = { data: { session: { user: { id: 'user-1' } } } }
    })
    afterEach(() => {
      aalResponse = { data: { currentLevel: 'aal1', nextLevel: 'aal1' } }
    })

    it('認証アプリ登録済みでコード未入力(aal1)なら、保護ページは /login/mfa へ（行き先を持ち回る）', async () => {
      aalResponse = { data: { currentLevel: 'aal1', nextLevel: 'aal2' } }
      const res = await proxy(makeRequest('/inbox?tab=all'))
      expect(redirectPath(res)).toBe('/login/mfa')
      expect(res.headers.get('location')).toContain('redirect=%2Finbox%3Ftab%3Dall')
    })

    it('コード入力済み(aal2)なら通す', async () => {
      aalResponse = { data: { currentLevel: 'aal2', nextLevel: 'aal2' } }
      const res = await proxy(makeRequest('/inbox'))
      expect(redirectPath(res)).toBeNull()
    })

    it('未登録(aal1/aal1)なら従来どおり通す。/login/mfa 自体は公開パスなので門番に掛からない', async () => {
      const res = await proxy(makeRequest('/inbox'))
      expect(redirectPath(res)).toBeNull()
      aalResponse = { data: { currentLevel: 'aal1', nextLevel: 'aal2' } }
      const res2 = await proxy(makeRequest('/login/mfa?redirect=%2Finbox'))
      expect(redirectPath(res2)).toBeNull()
    })
  })
})

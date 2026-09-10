import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/ApiSettings'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

/**
 * プロジェクト設定の API設定タブ。以前はタブを開くたびに
 * supabase.auth.getUser() → org_memberships → space_memberships → GET /api/keys を
 * 数珠つなぎで毎回取り直しており、開くたびに「権限を確認中...」→「読み込み中...」が必ず出ていた。
 * 判定はキャッシュ済みの hook（ActiveOrgContext の orgs一覧 / useSpaceMembers）から出し、
 * 鍵一覧は react-query に乗せる。
 *
 * 組織の役割は ActiveOrgContext（所属組織の一覧＋役割）から、URLのorgIdに一致する1件を探す。
 * 「いま選んでいる組織」だけでなく所属組織一覧全体を見るのがポイント（表示速度レビュー指摘#1）。
 */

const mockUseSpaceMembers = vi.fn()
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: (...args: unknown[]) => mockUseSpaceMembers(...args),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, loading: false, error: null }),
}))

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function membersFixture(role: string) {
  return {
    members: [{ id: 'user-1', displayName: 'Me', avatarUrl: null, role }],
    clientMembers: [],
    internalMembers: [],
    loading: false,
    isPending: false,
    error: null,
    refetch: vi.fn(),
    patchMembers: vi.fn(),
    getMemberName: vi.fn(),
  }
}

function orgContextFixture(overrides: Partial<ActiveOrgContextValue> = {}): ActiveOrgContextValue {
  return {
    activeOrgId: 'org-1',
    activeOrgName: 'Org',
    activeOrgRole: 'owner',
    orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }],
    switchOrg: vi.fn(),
    loading: false,
    ...overrides,
  }
}

function renderApiSettings(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  orgCtx: ActiveOrgContextValue = orgContextFixture()
) {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ActiveOrgContext.Provider value={orgCtx}>
        <ApiSettings orgId="org-1" spaceId="space-1" />
      </ActiveOrgContext.Provider>
    </QueryClientProvider>
  )
  return { ...utils, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  })
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: [] }),
  })
})

describe('ApiSettings — 権限に応じた表示', () => {
  it('組織のオーナーには管理画面（鍵一覧＋AI準備手順）を出す', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))

    renderApiSettings(undefined, orgContextFixture({
      orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }],
    }))

    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    expect(screen.getByText('AI（Claude Code など）から使う準備')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/keys?orgId=org-1&spaceId=space-1')
  })

  it('このプロジェクトの admin には管理画面を出す', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('admin'))

    renderApiSettings(undefined, orgContextFixture({
      orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'editor' }],
    }))

    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/keys?orgId=org-1&spaceId=space-1')
  })

  it.each(['editor', 'viewer', 'client'])(
    '空間の役割が %s のときは案内文を出し、鍵一覧は取りに行かない',
    async (role) => {
      mockUseSpaceMembers.mockReturnValue(membersFixture(role))

      renderApiSettings(undefined, orgContextFixture({
        orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'editor' }],
      }))

      expect(
        await screen.findByText(/API設定は管理者（org owner または space admin）のみ利用可能です/)
      ).toBeInTheDocument()
      expect(global.fetch).not.toHaveBeenCalled()
    }
  )

  it('同じ QueryClient で2回目に表示すると読み込み表示を出さずに一覧が出る', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const orgCtx = orgContextFixture({ orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }] })
    const first = renderApiSettings(queryClient, orgCtx)
    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    first.unmount()

    expect(global.fetch).toHaveBeenCalledTimes(1)

    render(
      <QueryClientProvider client={queryClient}>
        <ActiveOrgContext.Provider value={orgCtx}>
          <ApiSettings orgId="org-1" spaceId="space-1" />
        </ActiveOrgContext.Provider>
      </QueryClientProvider>
    )

    // キャッシュ済みなので「読み込み中...」を経由せず即座に一覧が出る
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument()
  })

  it('URLのorgIdが所属組織一覧に見つからないときはorg_membershipsを1回だけ引く', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('admin'))
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { role: 'owner' }, error: null }) }) }) }),
    })

    renderApiSettings(undefined, orgContextFixture({
      activeOrgId: 'org-other',
      orgs: [{ orgId: 'org-other', orgName: 'Other', role: 'owner' }],
    }))

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('org_memberships'))
    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
  })

  it('所属組織一覧の中に「いま選んでいる組織」以外でこのURLのorgIdがあれば、それも見つけて即座に管理画面を出す（org_membershipsは引かない）', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))

    renderApiSettings(undefined, orgContextFixture({
      activeOrgId: 'org-2',
      activeOrgRole: 'editor',
      orgs: [
        { orgId: 'org-2', orgName: 'Active', role: 'editor' },
        { orgId: 'org-1', orgName: 'Target', role: 'owner' },
      ],
    }))

    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    expect(mockFrom).not.toHaveBeenCalledWith('org_memberships')
  })

  it('【是正1】組織一覧の取得がまだ終わっていない（role不明）ときは「管理者のみ」ではなく「権限を確認中」を出す', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))
    // cookieでloadingは早々にfalseになるが、orgsはまだ空 = role不明（表示速度レビュー指摘#1の再現）
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }),
    })

    renderApiSettings(undefined, orgContextFixture({ orgs: [], loading: false }))

    expect(await screen.findByText('権限を確認中...')).toBeInTheDocument()
    expect(
      screen.queryByText(/API設定は管理者（org owner または space admin）のみ利用可能です/)
    ).not.toBeInTheDocument()
  })
})

describe('ApiSettings — 【是正2】裏の取り直し失敗と新規鍵モーダル', () => {
  it('発行直後の再取得が失敗しても、一度きりの鍵の表示は消えず、一覧はエラー画面に差し替わらない', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))

    let getCallCount = 0
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/keys?')) {
        getCallCount += 1
        if (getCallCount === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
        }
        // 発行後のinvalidateによる取り直しが失敗するケース
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'bad request' }) })
      }
      if (url === '/api/keys' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'key-new' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    })

    renderApiSettings(undefined, orgContextFixture({
      orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }],
    }))

    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByRole('button', { name: '発行' }))

    await waitFor(() => expect(screen.getByText('APIキーを保存してください')).toBeInTheDocument())

    // 裏の取り直し（invalidate後のrefetch）が失敗しても、モーダルは消えず、全面エラーにもならない
    await waitFor(() => expect(getCallCount).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('APIキーを保存してください')).toBeInTheDocument()
    expect(screen.queryByText('APIキーの取得に失敗しました')).not.toBeInTheDocument()
    // 失敗したことは小さな帯で知らせる（黙って古い一覧を出し続けない）
    await waitFor(() => expect(screen.getByText(/最新の一覧の取得に失敗しました/)).toBeInTheDocument())
  })
})

describe('ApiSettings — 【是正3】アカウントのAPIキー一覧との整合', () => {
  it('鍵の発行後、アカウントのAPIキー一覧（userApiKeys）のキャッシュも取り直す', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'key-new' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderApiSettings(queryClient, orgContextFixture({
      orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }],
    }))
    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByRole('button', { name: '発行' }))

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['userApiKeys'] }))
    )
  })

  it('鍵の削除後、アカウントのAPIキー一覧（userApiKeys）のキャッシュも取り直す', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: [{
            id: 'key-1',
            name: 'Existing',
            key_prefix: 'tsk_x...',
            created_at: '2026-09-01T00:00:00Z',
            last_used_at: null,
            expires_at: null,
            is_active: true,
            allowed_actions: ['read'],
            user_id: 'user-1',
          }],
        }),
      })
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderApiSettings(queryClient, orgContextFixture({
      orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }],
    }))
    await waitFor(() => expect(screen.getByText('Existing')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('削除'))

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['userApiKeys'] }))
    )
  })
})

describe('ApiSettings — 【是正4・任意】403は再試行せずspaceMembersを取り直す', () => {
  it('403を受けたら再試行せず、spaceMembersのキャッシュを取り直す', async () => {
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'forbidden' }),
    })

    // 本番の既定は「失敗したら再試行」。テストでも再試行ありにしておき、画面側の「4xx は再試行しない」
    // という決まりを外したら呼び出し回数が増えてこのテストが落ちるようにする
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderApiSettings(queryClient, orgContextFixture({
      orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }],
    }))

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['spaceMembers', 'space-1'] })
    )

    const keysGetCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).startsWith('/api/keys?')
    )
    expect(keysGetCalls).toHaveLength(1) // 再試行していない
  })
})

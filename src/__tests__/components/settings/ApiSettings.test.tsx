import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/ApiSettings'

/**
 * プロジェクト設定の API設定タブ。以前はタブを開くたびに
 * supabase.auth.getUser() → org_memberships → space_memberships → GET /api/keys を
 * 数珠つなぎで毎回取り直しており、開くたびに「権限を確認中...」→「読み込み中...」が必ず出ていた。
 * 判定はキャッシュ済みの hook（useCurrentOrg / useSpaceMembers）から出し、鍵一覧は react-query に乗せる。
 */

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

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

function orgFixture(orgId: string, role: string) {
  return { orgId, orgName: 'Org', role, loading: false, error: null }
}

function renderApiSettings(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ApiSettings orgId="org-1" spaceId="space-1" />
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
    mockUseCurrentOrg.mockReturnValue(orgFixture('org-1', 'owner'))
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))

    renderApiSettings()

    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    expect(screen.getByText('AI（Claude Code など）から使う準備')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/keys?orgId=org-1&spaceId=space-1')
  })

  it('このプロジェクトの admin には管理画面を出す', async () => {
    mockUseCurrentOrg.mockReturnValue(orgFixture('org-1', 'editor'))
    mockUseSpaceMembers.mockReturnValue(membersFixture('admin'))

    renderApiSettings()

    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/keys?orgId=org-1&spaceId=space-1')
  })

  it.each(['editor', 'viewer', 'client'])(
    '空間の役割が %s のときは案内文を出し、鍵一覧は取りに行かない',
    async (role) => {
      mockUseCurrentOrg.mockReturnValue(orgFixture('org-1', 'editor'))
      mockUseSpaceMembers.mockReturnValue(membersFixture(role))

      renderApiSettings()

      expect(
        await screen.findByText(/API設定は管理者（org owner または space admin）のみ利用可能です/)
      ).toBeInTheDocument()
      expect(global.fetch).not.toHaveBeenCalled()
    }
  )

  it('同じ QueryClient で2回目に表示すると読み込み表示を出さずに一覧が出る', async () => {
    mockUseCurrentOrg.mockReturnValue(orgFixture('org-1', 'owner'))
    mockUseSpaceMembers.mockReturnValue(membersFixture('viewer'))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = renderApiSettings(queryClient)
    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
    first.unmount()

    expect(global.fetch).toHaveBeenCalledTimes(1)

    render(
      <QueryClientProvider client={queryClient}>
        <ApiSettings orgId="org-1" spaceId="space-1" />
      </QueryClientProvider>
    )

    // キャッシュ済みなので「読み込み中...」を経由せず即座に一覧が出る
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument()
  })

  it('URLのorgIdがいま選んでいる組織と一致しないときはorg_membershipsを1回だけ引く', async () => {
    mockUseCurrentOrg.mockReturnValue(orgFixture('org-other', 'owner'))
    mockUseSpaceMembers.mockReturnValue(membersFixture('admin'))
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { role: 'owner' }, error: null }) }) }) }),
    })

    renderApiSettings()

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('org_memberships'))
    await waitFor(() => expect(screen.getByText('APIキーはまだ作成されていません')).toBeInTheDocument())
  })
})

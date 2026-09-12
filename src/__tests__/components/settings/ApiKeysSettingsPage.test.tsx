import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ApiKeysSettingsPage from '@/app/settings/api-keys/page'

/**
 * アカウントの「APIキー」一覧。以前は useEffect + fetch で毎回取り直しており、
 * react-query のキャッシュに乗っていなかった。一覧取得を useQuery にし、
 * 発行・削除のあとは invalidate で取り直す。
 *
 * また、ページ全体の待ちが spacesLoading（useUserSpaces、内部で userLoading も含む）まで
 * 巻き込んでいたため、鍵一覧が出せる状態でもスペース取得が遅いとページ全体が固まっていた。
 * 全体の待ちは userLoading だけにする。
 */

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}))
const mockUseCurrentUser = vi.fn()

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => mockUseUserSpaces(),
}))
const mockUseUserSpaces = vi.fn()

const mockConfirm = vi.fn().mockResolvedValue(true)
vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), ConfirmDialog: null }),
  SettingsBackButton: () => <div />,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/settings/CliSetupGuide', () => ({
  CliSetupGuide: () => <div data-testid="cli-setup-guide" />,
}))

/** サーバーが作る鍵の形（tsk_ + 英数字32文字）にそろえたテスト用の値 */
const TEST_SERVER_KEY = 'tsk_0123456789abcdefghijklmnopqrstuv'

function keysFixture(): Array<Record<string, unknown>> {
  return [
    {
      id: 'key-1',
      name: 'My Key',
      key_prefix: 'tsk_abc...',
      created_at: '2026-09-01T00:00:00Z',
      last_used_at: null,
      expires_at: null,
      is_active: true,
      scope: 'user',
      space_id: null,
      allowed_space_ids: [],
      allowed_actions: ['read'],
    },
  ]
}

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiKeysSettingsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
  mockUseCurrentUser.mockReturnValue({ user: { id: 'user-1' }, loading: false, error: null })
  mockUseUserSpaces.mockReturnValue({
    spaces: [{ id: 'space-1', name: 'Space 1', orgId: 'org-1', orgName: 'Org', role: 'admin', archivedAt: null }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  })
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: keysFixture() }),
  })
})

describe('ApiKeysSettingsPage — 一覧取得のキャッシュ化', () => {
  it('一覧を1回だけ取得する（useQuery経由）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('/api/keys/user')
  })

  it('発行後に一覧を取り直す', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '新しいAPIキーを作成' }))
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'New Key' } })
    fireEvent.click(screen.getByText('Space 1').closest('label')!.querySelector('button')!)

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys/user' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 'key-2' }, key: TEST_SERVER_KEY }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: keysFixture() }) })
    })

    fireEvent.click(screen.getByRole('button', { name: /APIキーを発行/ }))

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.filter((c) => c[0] === '/api/keys/user' && (!c[1] || c[1].method === undefined)).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('ページ全体の待ちは userLoading だけで判定し、spacesLoading では全体をブロックしない', async () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [],
      loading: true, // スペース取得だけが遅い
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    // userLoading が false なので、鍵一覧のヘッダーはすぐ出る（全画面スピナーで止まらない）
    await waitFor(() => expect(screen.getByText('発行済みAPIキー')).toBeInTheDocument())
  })
})

// キーはサーバー側で作る。画面はそれをそのまま表示するだけで、自分では作らない
describe('ApiKeysSettingsPage — キーはサーバーで作る（画面では作らない）', () => {
  function startCreatingKey() {
    fireEvent.click(screen.getByRole('button', { name: '新しいAPIキーを作成' }))
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'New Key' } })
    fireEvent.click(screen.getByText('Space 1').closest('label')!.querySelector('button')!)
  }

  it('サーバーから返ってきたキーをそのまま表示する', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())
    startCreatingKey()

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys/user' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 'key-2' }, key: TEST_SERVER_KEY }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: keysFixture() }) })
    })

    fireEvent.click(screen.getByRole('button', { name: /APIキーを発行/ }))

    await waitFor(() => expect(screen.getByText('APIキーを保存してください')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('キーを表示'))
    expect(screen.getByText(TEST_SERVER_KEY)).toBeInTheDocument()
  })

  it('発行の送信内容に keyHash・keyPrefix を含めない', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())
    startCreatingKey()

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys/user' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 'key-2' }, key: TEST_SERVER_KEY }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: keysFixture() }) })
    })

    fireEvent.click(screen.getByRole('button', { name: /APIキーを発行/ }))

    await waitFor(() => {
      const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/api/keys/user' && c[1]?.method === 'POST'
      )
      expect(postCall).toBeTruthy()
      const body = JSON.parse(postCall![1].body as string)
      expect(body).not.toHaveProperty('keyHash')
      expect(body).not.toHaveProperty('keyPrefix')
    })
  })
})

// API キーは社内メンバー（admin / editor / viewer）専用。相手先として参加しているプロジェクトは選べない
// （サーバーも /api/keys/user で断る。画面では最初から選択肢に出さない）
describe('ApiKeysSettingsPage — 社内メンバーのプロジェクトだけを選べる', () => {
  it('相手先として参加しているプロジェクトは、発行フォームの選択肢に出さない', async () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: 'Space 1', orgId: 'org-1', orgName: 'Org', role: 'admin', archivedAt: null },
        { id: 'space-2', name: 'Client Space', orgId: 'org-2', orgName: 'Other', role: 'client', archivedAt: null },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '新しいAPIキーを作成' }))

    expect(screen.getByText('Space 1')).toBeInTheDocument()
    expect(screen.queryByText('Client Space')).not.toBeInTheDocument()
  })

  it('選べるプロジェクトが1つも無ければ、社内メンバー向けの機能だと知らせる', async () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [{ id: 'space-2', name: 'Client Space', orgId: 'org-2', orgName: 'Other', role: 'client', archivedAt: null }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '新しいAPIキーを作成' }))

    expect(screen.getByText(/APIキーは社内メンバー向けの機能です/)).toBeInTheDocument()
    expect(screen.queryByText('Client Space')).not.toBeInTheDocument()
  })
})

describe('ApiKeysSettingsPage — 【是正3】プロジェクト設定側の一覧との整合', () => {
  it('発行後、プロジェクト設定のAPI設定タブが持つ一覧（apiKeys）のキャッシュも取り直す', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderPage(queryClient)
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '新しいAPIキーを作成' }))
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'New Key' } })
    fireEvent.click(screen.getByText('Space 1').closest('label')!.querySelector('button')!)

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys/user' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 'key-2' }, key: TEST_SERVER_KEY }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: keysFixture() }) })
    })

    fireEvent.click(screen.getByRole('button', { name: /APIキーを発行/ }))

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['apiKeys'] }))
    )
  })

  it('削除後、プロジェクト設定のAPI設定タブが持つ一覧（apiKeys）のキャッシュも取り直す', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderPage(queryClient)
    await waitFor(() => expect(screen.getByText('My Key')).toBeInTheDocument())

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    })

    fireEvent.click(screen.getByTitle('削除'))

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['apiKeys'] }))
    )
  })
})

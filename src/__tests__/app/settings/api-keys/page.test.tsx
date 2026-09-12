import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ApiKeysSettingsPage from '@/app/settings/api-keys/page'

/**
 * 個人のAPIキー作成画面。鍵の組織はサーバー側で「選んだプロジェクトの組織」から
 * 決まる（複数の組織にまたがると400で断られる）ため、画面側でも組織ごとに選択肢を
 * 分け、1つの組織のプロジェクトだけを選べるようにする。
 */

const mockUser = { id: 'user-1' }
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: false }),
}))

const initialSpaces = [
  { id: 'space-a1', name: 'プロジェクトA1', orgId: 'org-a', orgName: '組織A', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
  { id: 'space-a2', name: 'プロジェクトA2', orgId: 'org-a', orgName: '組織A', role: 'editor', archivedAt: null, groupId: null, sortOrder: 1 },
  { id: 'space-b1', name: 'プロジェクトB1', orgId: 'org-b', orgName: '組織B', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
  { id: 'space-archived', name: 'アーカイブ済みプロジェクト', orgId: 'org-a', orgName: '組織A', role: 'admin', archivedAt: '2026-01-01T00:00:00Z', groupId: null, sortOrder: 2 },
]
// let: 一覧が取り直されて中身が変わる（役割が変わった・space から外れた）ケースを
// テストで再現するため、テスト側から差し替えられるようにする
let mockSpaces = initialSpaces
const useUserSpacesMock = vi.fn((_options?: { includeArchived?: boolean }) => ({
  spaces: mockSpaces,
  loading: false,
}))
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (options?: { includeArchived?: boolean }) => useUserSpacesMock(options),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/components/settings/CliSetupGuide', () => ({ CliSetupGuide: () => null }))

const fetchMock = vi.fn()

// POST /api/keys/user（発行）の応答は、テストごとに差し替える。GET と同じ
// mockImplementation の中で method を見て答え分けるため、「次の1回」がどちらの
// 呼び出しかという順番に結果が左右されない（invalidateApiKeys() が POST 成功後に
// 追加の GET を発生させても、そのままGET用の分岐に落ちる）。
let postResponse: { ok: boolean; status?: number; json: () => Promise<unknown> } = {
  ok: false,
  status: 500,
  json: () => Promise.resolve({ error: 'postResponse not configured for this test' }),
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ApiKeysSettingsPage />
    </QueryClientProvider>
  )
  return { ...utils, queryClient }
}

function openCreateForm() {
  fireEvent.click(screen.getByText('新しいAPIキーを作成'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSpaces = initialSpaces
  postResponse = {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'postResponse not configured for this test' }),
  }
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/keys/user' && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    }
    if (url === '/api/keys/user' && method === 'POST') {
      return Promise.resolve(postResponse)
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('ApiKeysSettingsPage — プロジェクト選択は組織ごとに分かれ、1つの組織だけを選べる', () => {
  it('選択肢は組織ごとに見出しで分かれて表示される', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('組織A')).toBeInTheDocument())
    expect(screen.getByText('組織B')).toBeInTheDocument()
    expect(screen.getByText('プロジェクトA1')).toBeInTheDocument()
    expect(screen.getByText('プロジェクトB1')).toBeInTheDocument()
  })

  it('別の組織のプロジェクトを選ぶと、前の組織の選択は外れる', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトA1'))
    fireEvent.click(screen.getByText('プロジェクトA2'))
    // ここまではorg-aの2件が選択済み

    fireEvent.click(screen.getByText('プロジェクトB1'))

    // org-bを選んだことで、org-aの選択(2件)は外れ、org-bの1件だけが選ばれた状態で
    // 作成できる（「少なくとも1つ選択してください」の注意が消える＝選択が0件ではない）
    expect(screen.queryByText('少なくとも1つのプロジェクトを選択してください')).not.toBeInTheDocument()

    postResponse = { ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) }
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/keys/user', expect.anything()))
    // アサーションはmockの内側に書かない（成功パス以外の例外が起きるとページ側のtry/catchに
    // 飲み込まれ、テストの失敗として気づけないため。呼び出し後の記録を見て確かめる）
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    )
    const body = JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))
    expect(body.allowedSpaceIds).toEqual(['space-b1'])
  })

  it('「この組織を全部選択」は、その組織のプロジェクトだけを選ぶ（別の組織の選択は外れる）', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトB1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトB1'))

    const selectAllButtons = screen.getAllByText('この組織を全部選択')
    // 1番目が組織Aの見出し配下のボタン
    fireEvent.click(selectAllButtons[0])

    postResponse = { ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) }
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/keys/user', expect.anything()))
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    )
    const body = JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))
    expect([...body.allowedSpaceIds].sort()).toEqual(['space-a1', 'space-a2'])
  })

  // #808 レビューの残課題: 開いている間に一覧が取り直され、選んでいた space が
  // 選択肢から消えたとき（役割が変わった・space から外れた）は、選択からも外す。
  // 消えていない残りの選択はそのまま（足さずに置き換えるだけ＝purelyフィルタ）。
  it('一覧が取り直されて選んでいたプロジェクトが選択肢から消えたら、選択からも外れる', async () => {
    const { rerender, queryClient } = renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトA1'))
    fireEvent.click(screen.getByText('プロジェクトA2'))

    // プロジェクトA1の役割が変わる等で選択肢から消える（一覧の取り直しを模す）
    mockSpaces = initialSpaces.filter((s) => s.id !== 'space-a1')
    rerender(
      <QueryClientProvider client={queryClient}>
        <ApiKeysSettingsPage />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.queryByText('プロジェクトA1')).not.toBeInTheDocument())

    postResponse = { ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) }
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/keys/user', expect.anything()))
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    )
    const body = JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))
    // space-a1 は選択から外れ、残った space-a2 だけが送られる
    expect(body.allowedSpaceIds).toEqual(['space-a2'])
  })

  it('選んでいたプロジェクトが一覧から全部消えたあとも、別の組織のプロジェクトを選び直せる', async () => {
    const { rerender, queryClient } = renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトA1'))

    // org-aのプロジェクトが一覧から全部消える
    mockSpaces = initialSpaces.filter((s) => s.orgId !== 'org-a')
    rerender(
      <QueryClientProvider client={queryClient}>
        <ApiKeysSettingsPage />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.queryByText('プロジェクトA1')).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('プロジェクトB1'))

    postResponse = { ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) }
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/keys/user', expect.anything()))
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    )
    const body = JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))
    expect(body.allowedSpaceIds).toEqual(['space-b1'])
  })

  it('今の選択の組織が分からない(組織IDが空)ときは、足さずに新しい選択だけに置き換える', async () => {
    mockSpaces = [
      { id: 'space-unknown-org', name: 'プロジェクト不明組織', orgId: '', orgName: '', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      { id: 'space-a1', name: 'プロジェクトA1', orgId: 'org-a', orgName: '組織A', role: 'admin', archivedAt: null, groupId: null, sortOrder: 1 },
    ]
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクト不明組織')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクト不明組織'))
    fireEvent.click(screen.getByText('プロジェクトA1'))

    postResponse = { ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) }
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/keys/user', expect.anything()))
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    )
    const body = JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))
    expect(body.allowedSpaceIds).toEqual(['space-a1'])
  })
})

describe('ApiKeysSettingsPage — 左メニューと同じキャッシュを使い、アーカイブ済みは出さない', () => {
  it('useUserSpacesを左メニューと同じ引数(includeArchived: true)で呼ぶ（同じキャッシュを使い回して通信を1本減らす）', () => {
    renderPage()
    expect(useUserSpacesMock).toHaveBeenCalledWith({ includeArchived: true })
  })

  it('アーカイブ済みプロジェクトは選択肢に出さない', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    expect(screen.queryByText('アーカイブ済みプロジェクト')).not.toBeInTheDocument()
  })
})

describe('ApiKeysSettingsPage — 400の理由を日本語で伝える', () => {
  it('組織またぎの400が返ったら、日本語の理由をトーストで出す', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトA1'))
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })

    postResponse = {
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Selected projects must belong to the same organization' }),
    }
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        '選んだプロジェクトが複数の組織にまたがっています。1つの組織のプロジェクトだけを選んでください'
      )
    )
  })

  it('400以外(500等)は決まった一般文言のまま', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトA1'))
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })

    postResponse = {
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    }
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('APIキーの作成に失敗しました'))
  })
})

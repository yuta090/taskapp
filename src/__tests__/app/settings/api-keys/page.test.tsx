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

const mockSpaces = [
  { id: 'space-a1', name: 'プロジェクトA1', orgId: 'org-a', orgName: '組織A', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
  { id: 'space-a2', name: 'プロジェクトA2', orgId: 'org-a', orgName: '組織A', role: 'editor', archivedAt: null, groupId: null, sortOrder: 1 },
  { id: 'space-b1', name: 'プロジェクトB1', orgId: 'org-b', orgName: '組織B', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
]
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: mockSpaces, loading: false }),
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiKeysSettingsPage />
    </QueryClientProvider>
  )
}

function openCreateForm() {
  fireEvent.click(screen.getByText('新しいAPIキーを作成'))
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/keys/user') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
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

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) })
    )
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

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'tsk_dummy', data: {} }) })
    )
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/keys/user', expect.anything()))
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    )
    const body = JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))
    expect([...body.allowedSpaceIds].sort()).toEqual(['space-a1', 'space-a2'])
  })
})

describe('ApiKeysSettingsPage — 400の理由を日本語で伝える', () => {
  it('組織またぎの400が返ったら、日本語の理由をトーストで出す', async () => {
    renderPage()
    openCreateForm()

    await waitFor(() => expect(screen.getByText('プロジェクトA1')).toBeInTheDocument())
    fireEvent.click(screen.getByText('プロジェクトA1'))
    fireEvent.change(screen.getByPlaceholderText('例: Claude Code用'), { target: { value: 'テストキー' } })

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Selected projects must belong to the same organization' }),
      })
    )
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

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      })
    )
    fireEvent.click(screen.getByText('APIキーを発行'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('APIキーの作成に失敗しました'))
  })
})

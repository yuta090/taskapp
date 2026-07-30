import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TaskSyncConnectPanel } from '@/components/secretary/integrations/TaskSyncConnectPanel'
import { getTrelloAuthorizeUrl } from '@/lib/trello/config'
import type { ConnectorConnection } from '@/lib/hooks/useConnectors'

/**
 * TaskSyncConnectPanel — APIキー方式のタスク同期ツール(Backlog/Jooto/Jira/Redmine/Asana/Trello/Linear)
 * 接続UI。ConnectorSyncPane.test.tsx を手本にする(モーダル禁止・保存ボタン禁止=optimistic)。
 */

const { connectionsState, createTaskSyncMock, updateImportConfigMock, toastErrorMock } = vi.hoisted(() => ({
  connectionsState: { connections: [] as ConnectorConnection[], viewerRole: 'owner' as string | null, isLoading: false },
  createTaskSyncMock: vi.fn(),
  updateImportConfigMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectors: () => connectionsState,
    useCreateTaskSyncConnection: () => ({ mutateAsync: createTaskSyncMock, isPending: false }),
    useUpdateImportConfig: () => ({ mutateAsync: updateImportConfigMock, isPending: false }),
  }
})

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [{ id: 'space-1', name: '本店プロジェクト', orgId: 'org-1', orgName: 'Acme', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [],
    clientMembers: [],
    internalMembers: [{ id: 'user-1', displayName: '田中', avatarUrl: null, role: 'admin' }],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

function backlogConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-backlog-1',
    provider: 'backlog',
    status: 'active',
    baseUrl: 'https://acme.backlog.jp',
    label: null,
    importEnabled: false,
    importConfig: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionsState.connections = []
  connectionsState.viewerRole = 'owner'
  connectionsState.isLoading = false
})

describe('TaskSyncConnectPanel — 接続先URLが要るツール(host_and_key/any-https)', () => {
  it('backlog: 接続先URL欄を表示する', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="backlog" />)
    expect(screen.getByLabelText(/URL/)).toBeInTheDocument()
  })

  it('redmine: 接続先URL欄を表示する', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="redmine" />)
    expect(screen.getByLabelText(/URL/)).toBeInTheDocument()
  })
})

describe('TaskSyncConnectPanel — 固定ホストのツール(api_key)', () => {
  it('asana: 接続先URL欄を表示しない', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)
    expect(screen.queryByLabelText(/URL/)).not.toBeInTheDocument()
  })

  it('linear: 接続先URL欄を表示しない', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="linear" />)
    expect(screen.queryByLabelText(/URL/)).not.toBeInTheDocument()
  })
})

describe('TaskSyncConnectPanel — 接続フォーム(未接続)', () => {
  it('APIキー未入力では「接続する」を押せない', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)
    expect(screen.getByRole('button', { name: '接続する' })).toBeDisabled()
  })

  it('URLが要るツールでURL未入力では押せない(APIキーのみ入力)', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="backlog" />)
    fireEvent.change(screen.getByLabelText(/スペースURL/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('APIキー'), { target: { value: 'key-abc' } })
    expect(screen.getByRole('button', { name: '接続する' })).toBeDisabled()
  })

  it('送信するとcreateを呼び、成功後はAPIキー入力欄が空に戻る(画面に残さない)', async () => {
    createTaskSyncMock.mockResolvedValue({ connectionId: 'conn-1', provider: 'asana' })
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)

    const apiKeyInput = screen.getByLabelText('APIキー') as HTMLInputElement
    expect(apiKeyInput).toHaveAttribute('type', 'password')
    fireEvent.change(apiKeyInput, { target: { value: 'secret-key' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(createTaskSyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      provider: 'asana',
      apiKey: 'secret-key',
      baseUrl: undefined,
    })
    expect(apiKeyInput.value).toBe('')
  })

  it('URLが要るツールはbaseUrlも渡す', async () => {
    createTaskSyncMock.mockResolvedValue({ connectionId: 'conn-1', provider: 'backlog' })
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="backlog" />)

    fireEvent.change(screen.getByLabelText(/スペースURL/), { target: { value: 'https://acme.backlog.jp' } })
    fireEvent.change(screen.getByLabelText('APIキー'), { target: { value: 'key-abc' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(createTaskSyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      provider: 'backlog',
      apiKey: 'key-abc',
      baseUrl: 'https://acme.backlog.jp',
    })
  })

  it('APIエラー文言をそのままtoastで表示する', async () => {
    createTaskSyncMock.mockRejectedValue(new Error('APIキーが正しくないか、権限が足りません'))
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)

    fireEvent.change(screen.getByLabelText('APIキー'), { target: { value: 'wrong-key' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('APIキーが正しくないか、権限が足りません')
  })

  it('member: フォームを表示せず、owner/adminのみと案内する', () => {
    connectionsState.viewerRole = 'member'
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)
    expect(screen.queryByLabelText('APIキー')).not.toBeInTheDocument()
    expect(screen.getByText(/owner\/admin/)).toBeInTheDocument()
  })
})

describe('TaskSyncConnectPanel — 接続済み', () => {
  it('ステータス・接続先URL・取り込み設定(ImportConfigEditor)を表示する', () => {
    connectionsState.connections = [backlogConnection()]
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="backlog" />)

    expect(screen.getByText('有効')).toBeInTheDocument()
    expect(screen.getByText('https://acme.backlog.jp')).toBeInTheDocument()
    expect(screen.getByLabelText('取り込み先スペース')).toBeInTheDocument()
  })

  it('接続フォームは表示しない(二重接続を防ぐ)', () => {
    connectionsState.connections = [backlogConnection()]
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="backlog" />)
    expect(screen.queryByLabelText('APIキー')).not.toBeInTheDocument()
  })

  it('取り込み先スペースを選ぶとimport_enabledも同時にtrueへ更新する(選択=有効化。接続だけして永久に同期されないバグの回避)', async () => {
    connectionsState.connections = [backlogConnection({ importConfig: {}, importEnabled: false })]
    updateImportConfigMock.mockResolvedValue({
      id: 'conn-backlog-1',
      importConfig: { target_space_id: 'space-1' },
      importEnabled: true,
    })
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="backlog" />)

    const select = screen.getByLabelText('取り込み先スペース')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'space-1' } })
    })

    expect(updateImportConfigMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-backlog-1',
      importConfig: { target_space_id: 'space-1' },
      importEnabled: true,
    })
  })
})

describe('TaskSyncConnectPanel — Jiraのメールアドレス欄(Basic認証)', () => {
  it('jira: メールアドレス欄を表示する', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="jira" />)
    expect(screen.getByLabelText(/メールアドレス/)).toBeInTheDocument()
  })

  it('asana: メールアドレス欄を表示しない(Jira固有の入力)', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)
    expect(screen.queryByLabelText(/メールアドレス/)).not.toBeInTheDocument()
  })

  it('メール未入力では「接続する」を押せない', () => {
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="jira" />)
    fireEvent.change(screen.getByLabelText(/サイトURL/), { target: { value: 'https://acme.atlassian.net' } })
    fireEvent.change(screen.getByLabelText('APIキー'), { target: { value: 'token-abc' } })
    expect(screen.getByRole('button', { name: '接続する' })).toBeDisabled()
  })

  it('送信時にprovider_config(jira_email)を渡す', async () => {
    createTaskSyncMock.mockResolvedValue({ connectionId: 'conn-1', provider: 'jira' })
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="jira" />)

    fireEvent.change(screen.getByLabelText(/サイトURL/), { target: { value: 'https://acme.atlassian.net' } })
    fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'admin@acme.com' } })
    fireEvent.change(screen.getByLabelText('APIキー'), { target: { value: 'token-abc' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(createTaskSyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      provider: 'jira',
      apiKey: 'token-abc',
      baseUrl: 'https://acme.atlassian.net',
      providerConfig: { jira_email: 'admin@acme.com' },
    })
  })

  it('メール以外のツール(asana)はprovider_configを渡さない', async () => {
    createTaskSyncMock.mockResolvedValue({ connectionId: 'conn-1', provider: 'asana' })
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)

    fireEvent.change(screen.getByLabelText('APIキー'), { target: { value: 'secret-key' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(createTaskSyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      provider: 'asana',
      apiKey: 'secret-key',
      baseUrl: undefined,
      providerConfig: undefined,
    })
  })
})

/**
 * Trello だけは「APIキーをどこかで発行してくる」では繋がらない。トークンは TaskApp の
 * アプリキーを載せた許可URLからでないと発行できず、運用者が自力で辿り着く術が無かった。
 * 接続フォームからその許可画面へ行けるようにする。
 */
describe('TaskSyncConnectPanel — Trelloのトークン発行導線', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未接続のとき、許可画面へのリンクを出す', () => {
    vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', 'public-app-key')
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="trello" />)

    const link = screen.getByRole('link', { name: /トークンを発行/ })
    expect(link).toHaveAttribute('href', getTrelloAuthorizeUrl())
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('アプリキーが未設定ならリンクの代わりに設定不足を伝える(黙って行き止まりにしない)', () => {
    vi.stubEnv('TRELLO_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', '')
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="trello" />)

    expect(screen.queryByRole('link', { name: /トークンを発行/ })).not.toBeInTheDocument()
    expect(screen.getByText(/管理者/)).toBeInTheDocument()
  })

  it('他のツール(asana)には出さない(Trello固有の導線)', () => {
    vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', 'public-app-key')
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="asana" />)

    expect(screen.queryByRole('link', { name: /トークンを発行/ })).not.toBeInTheDocument()
  })

  it('接続済みなら出さない(もう要らない)', () => {
    vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', 'public-app-key')
    connectionsState.connections = [backlogConnection({ id: 'conn-trello-1', provider: 'trello', baseUrl: null })]
    render(<TaskSyncConnectPanel orgId="org-1" integrationId="trello" />)

    expect(screen.queryByRole('link', { name: /トークンを発行/ })).not.toBeInTheDocument()
  })
})

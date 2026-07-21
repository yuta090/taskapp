import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TaskSyncConnectPanel } from '@/components/secretary/integrations/TaskSyncConnectPanel'
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
})

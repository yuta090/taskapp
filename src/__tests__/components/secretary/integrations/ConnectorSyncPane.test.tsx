import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { ConnectorSyncPane } from '@/components/secretary/integrations/ConnectorSyncPane'
import type { ConnectorConnection } from '@/lib/hooks/useConnectors'

/**
 * ConnectorSyncPane — 双方向同期(multica/gtasks)の接続管理UI。モーダル禁止・保存ボタン禁止(optimistic)。
 * owner/adminのみ作成・ローテ・import_config編集が可能(memberは閲覧のみ)。
 */

const {
  connectionsState,
  createMulticaMock,
  rotateMulticaMock,
  updateImportConfigMock,
  confirmMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  connectionsState: { connections: [] as ConnectorConnection[], viewerRole: 'owner' as string | null, isLoading: false },
  createMulticaMock: vi.fn(),
  rotateMulticaMock: vi.fn(),
  updateImportConfigMock: vi.fn(),
  confirmMock: vi.fn().mockResolvedValue(true),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectors: () => connectionsState,
    useCreateMulticaConnection: () => ({ mutateAsync: createMulticaMock, isPending: false }),
    useRotateMulticaSecret: () => ({ mutateAsync: rotateMulticaMock, isPending: false }),
    useUpdateImportConfig: () => ({ mutateAsync: updateImportConfigMock, isPending: false }),
  }
})

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [
      { id: 'space-1', name: '本店プロジェクト', orgId: 'org-1', orgName: 'Acme', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      { id: 'space-other-org', name: '別組織', orgId: 'org-2', orgName: 'Other', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [{ id: 'user-1', displayName: '田中', avatarUrl: null, role: 'admin' }],
    clientMembers: [],
    internalMembers: [{ id: 'user-1', displayName: '田中', avatarUrl: null, role: 'admin' }],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialog: null }),
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

function multicaConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-multica-1',
    provider: 'multica',
    status: 'active',
    baseUrl: 'https://multica.example.com',
    importEnabled: false,
    importConfig: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

function gtasksConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-gtasks-1',
    provider: 'google_tasks',
    status: 'active',
    baseUrl: null,
    importEnabled: true,
    importConfig: { target_space_id: 'space-1' },
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  confirmMock.mockResolvedValue(true)
  connectionsState.connections = []
  connectionsState.viewerRole = 'owner'
  connectionsState.isLoading = false
})

describe('ConnectorSyncPane — multica', () => {
  it('未接続・owner: 作成フォームを表示し、送信するとcreateを呼びMulticaConnectionRevealを表示する', async () => {
    createMulticaMock.mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'https://multica.example.com',
      webhookUrl: 'https://taskapp.example.com/api/connectors/multica/events',
      sendSecret: 'send_abc',
      receiveSecret: 'recv_abc',
    })

    render(<ConnectorSyncPane orgId="org-1" />)

    const input = screen.getByLabelText('multicaのURL')
    fireEvent.change(input, { target: { value: 'https://multica.example.com' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /接続を作成/ }))
    })

    expect(createMulticaMock).toHaveBeenCalledWith({ orgId: 'org-1', baseUrl: 'https://multica.example.com' })
    expect(screen.getByText('https://taskapp.example.com/api/connectors/multica/events')).toBeInTheDocument()
    expect(screen.getByText('send_abc')).toBeInTheDocument()
    expect(screen.getByText('recv_abc')).toBeInTheDocument()
  })

  it('未接続・member: 作成フォームを表示しない', () => {
    connectionsState.viewerRole = 'member'
    render(<ConnectorSyncPane orgId="org-1" />)
    expect(screen.queryByLabelText('multicaのURL')).not.toBeInTheDocument()
  })

  it('接続済み・owner: ステータス/URLを表示し、鍵ローテボタンで確認後にrotateを呼びSecretRevealを表示する', async () => {
    connectionsState.connections = [multicaConnection()]
    rotateMulticaMock.mockResolvedValue({ direction: 'send', secret: 'send_rotated' })

    render(<ConnectorSyncPane orgId="org-1" />)

    expect(screen.getByText('https://multica.example.com')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送信鍵を再生成' }))
    })

    expect(confirmMock).toHaveBeenCalled()
    expect(rotateMulticaMock).toHaveBeenCalledWith({ orgId: 'org-1', connectionId: 'conn-multica-1', direction: 'send' })
    expect(screen.getByText('send_rotated')).toBeInTheDocument()
  })

  it('接続済み・member: 鍵ローテボタンを表示しない', () => {
    connectionsState.connections = [multicaConnection()]
    connectionsState.viewerRole = 'member'
    render(<ConnectorSyncPane orgId="org-1" />)
    expect(screen.queryByRole('button', { name: /鍵を再生成/ })).not.toBeInTheDocument()
  })
})

describe('ConnectorSyncPane — google_tasks', () => {
  it('接続なし: 案内リンクを表示する', () => {
    render(<ConnectorSyncPane orgId="org-1" />)
    const link = screen.getByRole('link', { name: /Google Tasks/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('/api/integrations/auth/google_tasks?orgId=org-1'))
  })

  it('接続あり: import_configエディタでスペース選択の変更が即時PATCHを呼ぶ(保存ボタンなし)', async () => {
    connectionsState.connections = [gtasksConnection()]
    updateImportConfigMock.mockResolvedValue({ id: 'conn-gtasks-1', importConfig: { target_space_id: 'space-1' } })

    render(<ConnectorSyncPane orgId="org-1" />)

    const select = screen.getByLabelText('取り込み先スペース') as HTMLSelectElement
    expect(select.value).toBe('space-1')
    // 別組織のスペースは選択肢に出ない(org境界)
    expect(within(select).queryByText('別組織')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.change(select, { target: { value: '' } })
    })

    expect(updateImportConfigMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-gtasks-1',
      importConfig: {},
    })
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
  })

  it('read_list_idsはカンマ区切りテキストのblurで確定する', async () => {
    connectionsState.connections = [gtasksConnection()]
    updateImportConfigMock.mockResolvedValue({ id: 'conn-gtasks-1', importConfig: {} })

    render(<ConnectorSyncPane orgId="org-1" />)

    const input = screen.getByLabelText(/読み込み対象リスト/)
    fireEvent.change(input, { target: { value: 'list-1, list-2 ,, list-3' } })
    await act(async () => {
      fireEvent.blur(input)
    })

    expect(updateImportConfigMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-gtasks-1',
      importConfig: { target_space_id: 'space-1', read_list_ids: ['list-1', 'list-2', 'list-3'] },
    })
  })

  it('更新失敗時はエラートーストを表示する', async () => {
    connectionsState.connections = [gtasksConnection()]
    updateImportConfigMock.mockRejectedValue(new Error('取り込み先はこの組織のスペース/メンバーのみ指定できます'))

    render(<ConnectorSyncPane orgId="org-1" />)

    const select = screen.getByLabelText('取り込み先スペース')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'space-1' } })
    })

    expect(toastErrorMock).toHaveBeenCalledWith('取り込み先はこの組織のスペース/メンバーのみ指定できます')
  })

  it('member: import_config入力は無効化される', () => {
    connectionsState.connections = [gtasksConnection()]
    connectionsState.viewerRole = 'member'
    render(<ConnectorSyncPane orgId="org-1" />)
    expect(screen.getByLabelText('取り込み先スペース')).toBeDisabled()
  })
})

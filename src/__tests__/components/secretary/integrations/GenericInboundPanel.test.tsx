import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { GenericInboundPanel } from '@/components/secretary/integrations/GenericInboundPanel'
import type { ConnectorConnection } from '@/lib/hooks/useConnectors'

/**
 * GenericInboundPanel — 汎用Webhook受信(generic_inbound)の接続UI。
 * ConnectorSyncPane.test.tsxを手本にする(モーダル禁止・保存ボタン禁止=optimistic、
 * owner/adminのみ作成・設定が可能)。
 */

const {
  connectionsState,
  createGenericInboundMock,
  updateImportConfigMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  connectionsState: { connections: [] as ConnectorConnection[], viewerRole: 'owner' as string | null, isLoading: false },
  createGenericInboundMock: vi.fn(),
  updateImportConfigMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectors: () => connectionsState,
    useCreateGenericInboundConnection: () => ({ mutateAsync: createGenericInboundMock, isPending: false }),
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

function genericConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-generic-1',
    provider: 'generic_inbound',
    status: 'active',
    baseUrl: null,
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

describe('GenericInboundPanel — 未作成', () => {
  it('owner: 呼び名(任意)入力欄と作成ボタンを表示する', () => {
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getByLabelText(/呼び名/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '受信口を作る' })).toBeInTheDocument()
  })

  it('member: 作成フォームを表示しない', () => {
    connectionsState.viewerRole = 'member'
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.queryByLabelText(/呼び名/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '受信口を作る' })).not.toBeInTheDocument()
  })
})

describe('GenericInboundPanel — 作成', () => {
  it('送信するとcreateを呼び、webhook_urlとreceive_secretを一度だけ表示する', async () => {
    createGenericInboundMock.mockResolvedValue({
      connectionId: 'conn-new-1',
      webhookUrl: 'https://taskapp.example.com/api/connectors/generic/events',
      receiveSecret: 'recv_plain_abc',
    })

    render(<GenericInboundPanel orgId="org-1" />)

    fireEvent.change(screen.getByLabelText(/呼び名/), { target: { value: 'ANDPAD経由' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '受信口を作る' }))
    })

    expect(createGenericInboundMock).toHaveBeenCalledWith({ orgId: 'org-1', label: 'ANDPAD経由' })
    expect(screen.getByText('https://taskapp.example.com/api/connectors/generic/events')).toBeInTheDocument()
    expect(screen.getByText('recv_plain_abc')).toBeInTheDocument()
  })

  it('呼び名は任意: 空でも作成でき、labelはundefinedで渡す', async () => {
    createGenericInboundMock.mockResolvedValue({
      connectionId: 'conn-new-2',
      webhookUrl: 'https://taskapp.example.com/api/connectors/generic/events',
      receiveSecret: 'recv_plain_xyz',
    })
    render(<GenericInboundPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '受信口を作る' }))
    })

    expect(createGenericInboundMock).toHaveBeenCalledWith({ orgId: 'org-1', label: undefined })
  })

  it('作成に失敗したらエラートーストを表示し、secretは表示しない', async () => {
    createGenericInboundMock.mockRejectedValue(new Error('この呼び名の受信口は既にあります'))
    render(<GenericInboundPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '受信口を作る' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('この呼び名の受信口は既にあります')
    expect(screen.queryByText(/recv_/)).not.toBeInTheDocument()
  })

  it('secretは接続一覧のAPI応答に含まれないため、パネルを作り直す(再マウント)と表示されなくなる', async () => {
    createGenericInboundMock.mockResolvedValue({
      connectionId: 'conn-new-1',
      webhookUrl: 'https://taskapp.example.com/api/connectors/generic/events',
      receiveSecret: 'recv_plain_abc',
    })

    const { unmount } = render(<GenericInboundPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '受信口を作る' }))
    })
    expect(screen.getByText('recv_plain_abc')).toBeInTheDocument()

    // 別ツールを見て戻る・ページを開き直す等でこのパネルは一度アンマウントされる。
    // secretはローカルstateにしか無い(一覧取得のconnectionsには乗らない)ため、再マウント後は残らない。
    unmount()
    connectionsState.connections = [genericConnection()]
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.queryByText('recv_plain_abc')).not.toBeInTheDocument()
  })

  it('secretバナーは閉じるボタンで消える', async () => {
    createGenericInboundMock.mockResolvedValue({
      connectionId: 'conn-new-1',
      webhookUrl: 'https://taskapp.example.com/api/connectors/generic/events',
      receiveSecret: 'recv_plain_abc',
    })
    render(<GenericInboundPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '受信口を作る' }))
    })
    expect(screen.getByText('recv_plain_abc')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByText('recv_plain_abc')).not.toBeInTheDocument()
  })
})

describe('GenericInboundPanel — 作成済み', () => {
  it('呼び名が設定されていればそれを表示する(識別子ではなく呼び名優先)', () => {
    connectionsState.connections = [genericConnection({ label: 'ANDPAD経由' })]
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getByText('ANDPAD経由')).toBeInTheDocument()
    expect(screen.queryByText(/^#conn-gen/)).not.toBeInTheDocument()
  })

  it('呼び名が未設定(null)なら接続IDの先頭で代替表示する', () => {
    connectionsState.connections = [genericConnection({ label: null })]
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getByText('#conn-gen')).toBeInTheDocument()
  })

  it('取り込み先スペース未設定を目立つ形で警告する(未設定だと受信は422で弾かれる)', () => {
    connectionsState.connections = [genericConnection({ importConfig: {} })]
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getByTestId('generic-inbound-target-space-warning')).toHaveTextContent('422')
  })

  it('取り込み先スペース設定済みなら警告を出さない', () => {
    connectionsState.connections = [genericConnection({ importConfig: { target_space_id: 'space-1' }, importEnabled: true })]
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.queryByTestId('generic-inbound-target-space-warning')).not.toBeInTheDocument()
  })

  it('ImportConfigEditor(取り込み先スペース選択)を表示し、選択で即時PATCHを呼ぶ(保存ボタンなし)', async () => {
    connectionsState.connections = [genericConnection({ importConfig: {} })]
    updateImportConfigMock.mockResolvedValue({ id: 'conn-generic-1', importConfig: { target_space_id: 'space-1' }, importEnabled: true })
    render(<GenericInboundPanel orgId="org-1" />)

    const select = screen.getByLabelText('取り込み先スペース')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'space-1' } })
    })

    expect(updateImportConfigMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-generic-1',
      importConfig: { target_space_id: 'space-1' },
      importEnabled: true,
    })
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
  })

  it('member: 取り込み先スペースselectは無効化される', () => {
    connectionsState.connections = [genericConnection()]
    connectionsState.viewerRole = 'member'
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getByLabelText('取り込み先スペース')).toBeDisabled()
  })

  it('複数の受信口を一覧表示する', () => {
    connectionsState.connections = [
      genericConnection({ id: 'conn-generic-1', status: 'active' }),
      genericConnection({ id: 'conn-generic-2', status: 'revoked' }),
    ]
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getAllByLabelText('取り込み先スペース')).toHaveLength(2)
  })
})

describe('GenericInboundPanel — 送信側の設定手順', () => {
  it('署名ヘッダと送信ペイロードの例(JSON)を表示する', () => {
    render(<GenericInboundPanel orgId="org-1" />)
    expect(screen.getByText(/X-AgentPM-Signature/)).toBeInTheDocument()
    const example = screen.getByTestId('generic-inbound-payload-example')
    expect(example).toHaveTextContent('event_id')
    expect(example).toHaveTextContent('task.created')
    expect(example).toHaveTextContent('external_id')
    expect(example).toHaveTextContent('due_date')
  })
})

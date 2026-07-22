import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { KintoneConnectPanel } from '@/components/secretary/integrations/KintoneConnectPanel'
import type { ConnectorConnection } from '@/lib/hooks/useConnectors'

/**
 * KintoneConnectPanel — kintone専用の接続パネル。TaskSyncConnectPanel(汎用)と違い、
 * アプリID(複数)＋APIトークン(アプリごと)を入力させる。「アプリを更新」の案内を先に出す。
 * モーダル禁止・保存ボタン無し(ただし接続作成/マッピング確定は例外。CLAUDE.md参照)。
 */

const { connectionsState, createTaskSyncMock, toastErrorMock } = vi.hoisted(() => ({
  connectionsState: { connections: [] as ConnectorConnection[], viewerRole: 'owner' as string | null, isLoading: false },
  createTaskSyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectors: () => connectionsState,
    useCreateTaskSyncConnection: () => ({ mutateAsync: createTaskSyncMock, isPending: false }),
  }
})

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

vi.mock('@/components/secretary/integrations/ConnectorSyncPane', () => ({
  ImportConfigEditor: ({ connection }: { connection: ConnectorConnection }) => (
    <div data-testid="import-config-editor">{connection.id}</div>
  ),
}))

vi.mock('@/components/secretary/integrations/KintoneAppsPanel', () => ({
  KintoneAppsPanel: ({ connection }: { connection: ConnectorConnection }) => (
    <div data-testid="kintone-apps-panel">{connection.id}</div>
  ),
}))

function kintoneConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-kintone-1',
    provider: 'kintone',
    status: 'active',
    baseUrl: 'https://acme.cybozu.com',
    label: null,
    importEnabled: false,
    importConfig: { kintone_app_ids: ['5'] },
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionsState.connections = []
  connectionsState.viewerRole = 'owner'
  connectionsState.isLoading = false
})

describe('KintoneConnectPanel — 未接続(接続フォーム)', () => {
  it('member: フォームを表示せず、owner/adminのみと案内する', () => {
    connectionsState.viewerRole = 'member'
    render(<KintoneConnectPanel orgId="org-1" />)
    expect(screen.queryByLabelText('サブドメイン')).not.toBeInTheDocument()
    expect(screen.getByText(/owner\/admin/)).toBeInTheDocument()
  })

  it('「アプリを更新」の案内を先に表示する(失敗してから気づくのではなく予防する)', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    expect(screen.getByText(/アプリを更新/)).toBeInTheDocument()
  })

  it('サブドメイン・アプリのURL/ID・APIトークンの入力欄を表示する', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    expect(screen.getByLabelText('サブドメイン')).toBeInTheDocument()
    expect(screen.getByLabelText('アプリのURLまたはアプリID')).toBeInTheDocument()
    expect(screen.getByLabelText('APIトークン')).toBeInTheDocument()
  })

  it('未入力では「接続する」を押せない', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    expect(screen.getByRole('button', { name: '接続する' })).toBeDisabled()
  })

  it('「アプリを追加」で行が増え、最大9行まで(超えたら追加ボタンが無効)', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    const addButton = screen.getByRole('button', { name: /アプリを追加/ })
    for (let i = 0; i < 8; i++) {
      fireEvent.click(addButton)
    }
    expect(screen.getAllByLabelText('アプリのURLまたはアプリID')).toHaveLength(9)
    expect(addButton).toBeDisabled()
  })

  it('行が1つのときは「削除」ボタンを出さない(最低1行は必要)', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('行を追加してから削除すると1行に戻る', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    fireEvent.click(screen.getByRole('button', { name: /アプリを追加/ }))
    expect(screen.getAllByLabelText('アプリのURLまたはアプリID')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])
    expect(screen.getAllByLabelText('アプリのURLまたはアプリID')).toHaveLength(1)
  })

  it('同じアプリを複数行に指定すると重複エラーを表示し送信できない', () => {
    render(<KintoneConnectPanel orgId="org-1" />)
    fireEvent.change(screen.getByLabelText('サブドメイン'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: /アプリを追加/ }))
    const idInputs = screen.getAllByLabelText('アプリのURLまたはアプリID')
    const tokenInputs = screen.getAllByLabelText('APIトークン')
    fireEvent.change(idInputs[0], { target: { value: '5' } })
    fireEvent.change(tokenInputs[0], { target: { value: 'token-a' } })
    fireEvent.change(idInputs[1], { target: { value: '5' } })
    fireEvent.change(tokenInputs[1], { target: { value: 'token-b' } })

    expect(screen.getByText(/同じアプリ/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '接続する' })).toBeDisabled()
  })

  it('全欄を入力すると送信でき、apiKey(カンマ結合)・baseUrl・kintone_app_idsを渡す', async () => {
    createTaskSyncMock.mockResolvedValue({ connectionId: 'conn-1', provider: 'kintone' })
    render(<KintoneConnectPanel orgId="org-1" />)

    fireEvent.change(screen.getByLabelText('サブドメイン'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: /アプリを追加/ }))
    const idInputs = screen.getAllByLabelText('アプリのURLまたはアプリID')
    const tokenInputs = screen.getAllByLabelText('APIトークン')
    fireEvent.change(idInputs[0], { target: { value: 'https://acme.cybozu.com/k/5/' } })
    fireEvent.change(tokenInputs[0], { target: { value: 'token-5' } })
    fireEvent.change(idInputs[1], { target: { value: '9' } })
    fireEvent.change(tokenInputs[1], { target: { value: 'token-9' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(createTaskSyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      provider: 'kintone',
      apiKey: 'token-5,token-9',
      baseUrl: 'https://acme.cybozu.com',
      providerConfig: { kintone_app_ids: ['5', '9'] },
    })
  })

  it('APIエラー文言をそのままtoastで表示する', async () => {
    createTaskSyncMock.mockRejectedValue(new Error('kintoneはアプリIDを1つ以上指定してください'))
    render(<KintoneConnectPanel orgId="org-1" />)

    fireEvent.change(screen.getByLabelText('サブドメイン'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('アプリのURLまたはアプリID'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('APIトークン'), { target: { value: 'token-5' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接続する' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('kintoneはアプリIDを1つ以上指定してください')
  })
})

describe('KintoneConnectPanel — 接続済み', () => {
  it('接続先URL・取り込み設定(ImportConfigEditor)・アプリ管理(KintoneAppsPanel)を表示する', () => {
    connectionsState.connections = [kintoneConnection()]
    render(<KintoneConnectPanel orgId="org-1" />)

    expect(screen.getByText('https://acme.cybozu.com')).toBeInTheDocument()
    expect(screen.getByTestId('import-config-editor')).toHaveTextContent('conn-kintone-1')
    expect(screen.getByTestId('kintone-apps-panel')).toHaveTextContent('conn-kintone-1')
  })

  it('接続フォームは表示しない(二重接続を防ぐ)', () => {
    connectionsState.connections = [kintoneConnection()]
    render(<KintoneConnectPanel orgId="org-1" />)
    expect(screen.queryByLabelText('サブドメイン')).not.toBeInTheDocument()
  })
})

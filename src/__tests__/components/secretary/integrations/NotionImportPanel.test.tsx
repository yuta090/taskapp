import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { NotionImportPanel } from '@/components/secretary/integrations/NotionImportPanel'
import type { ConnectorConnection, ProposeNotionMappingResult } from '@/lib/hooks/useConnectors'

/**
 * NotionImportPanel — Notion取り込み(inbound)設定UI。
 *
 * - 未接続なら「Notion に接続」導線を案内する(新規接続はさせない)
 * - 接続済みならデータベース一覧(containers API相当)を出し、行ごとに取り込み中/未設定を示す
 *   (判定はcontainers一覧ではなくconnection.importConfig.read_container_idsから導出する。
 *   真実源を1つに揃えるため — 詳細はuseConnectionContainers/useSaveNotionMappingのコメント参照)
 * - 「設定する」でマッピング提案(useNotionMappingProposal。useQuery化済み)を表示し、期日/完了の
 *   対応づけを1回確認してから明示ボタンで保存する(この画面唯一の保存ボタン。他は楽観更新)
 * - AI提案が使えなかった場合は責めない調子で伝え、導線は止めない
 * - 保存APIの400エラー理由をそのまま見せる
 * - 「取り込みをやめる」はread_container_idsから外すoptimistic update(一覧レベルで1つの
 *   mutationに集約。行ごとの独立mutationにするとlost updateが起きるため)
 * - canManage=falseの非管理者にはcontainers一覧を出さず(APIを呼ばず)案内だけ出す
 *
 * ⚠ 「2件を連続して解除しても復活しない(lost updateの回帰)」と「実行中は全行を無効化する」の
 * 厳密な非同期タイミング検証は、useConnectors/useUpdateImportConfigを実装のまま使う統合テスト
 * (NotionImportPanel.lostUpdate.test.tsx)で行う。このファイルは全フックをモックしているため、
 * 「送信されるPATCH bodyが正しいか」「UIの分岐」までを受け持つ。
 */

const {
  sinksState,
  connectionsState,
  containersState,
  proposalState,
  saveMutateAsyncMock,
  updateImportConfigMutateAsyncMock,
  toastErrorMock,
  useConnectionContainersMock,
  useNotionMappingProposalMock,
} = vi.hoisted(() => {
  const containersState = {
    containers: [] as Array<{ id: string; title: string }>,
    isLoading: false,
    error: null as string | null,
    refetch: vi.fn(),
  }
  const proposalState = {
    data: undefined as ProposeNotionMappingResult | undefined,
    isLoading: false,
    error: null as string | null,
  }
  return {
    sinksState: { notionConnection: { connected: false, workspaceName: null as string | null } },
    connectionsState: { connections: [] as ConnectorConnection[], viewerRole: 'owner' as string | null, isLoading: false },
    containersState,
    proposalState,
    saveMutateAsyncMock: vi.fn(),
    updateImportConfigMutateAsyncMock: vi.fn(),
    toastErrorMock: vi.fn(),
    useConnectionContainersMock: vi.fn(() => containersState),
    useNotionMappingProposalMock: vi.fn(() => proposalState),
  }
})

vi.mock('@/lib/hooks/useSinks', () => ({
  useSinks: () => sinksState,
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectors: () => connectionsState,
    useConnectionContainers: useConnectionContainersMock,
    useNotionMappingProposal: useNotionMappingProposalMock,
    useSaveNotionMapping: () => ({ mutateAsync: saveMutateAsyncMock, isPending: false }),
    useUpdateImportConfig: () => ({ mutateAsync: updateImportConfigMutateAsyncMock, isPending: false }),
  }
})

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

function notionConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-notion-1',
    provider: 'notion',
    status: 'active',
    baseUrl: null,
    label: null,
    importEnabled: true,
    importConfig: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

const DATE_PROP = { id: 'due-1', name: '期日', type: 'date' }
const STATUS_PROP = {
  id: 'status-1',
  name: 'ステータス',
  type: 'status',
  options: [
    { id: 'opt-todo', name: '未着手' },
    { id: 'opt-done', name: '完了' },
  ],
}
const CHECKBOX_PROP = { id: 'done-1', name: '完了フラグ', type: 'checkbox' }

function proposeResult(overrides: Partial<ProposeNotionMappingResult> = {}): ProposeNotionMappingResult {
  return {
    schema: [DATE_PROP, STATUS_PROP],
    proposal: {
      due_prop_id: 'due-1',
      status: { prop_id: 'status-1', prop_type: 'status', done_option_ids: ['opt-done'], write_done_option_id: 'opt-done' },
    },
    proposalSource: 'ai',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sinksState.notionConnection = { connected: false, workspaceName: null }
  connectionsState.connections = []
  connectionsState.viewerRole = 'owner'
  connectionsState.isLoading = false
  containersState.containers = []
  containersState.isLoading = false
  containersState.error = null
  proposalState.data = proposeResult()
  proposalState.isLoading = false
  proposalState.error = null
  saveMutateAsyncMock.mockResolvedValue({
    databaseId: 'db-1',
    mapping: { due_prop_id: 'due-1', status: null, confirmed_at: '2026-07-21T00:00:00.000Z' },
  })
})

describe('NotionImportPanel — 未接続', () => {
  it('Notionに接続する導線を案内する(新規接続はここではさせない)', () => {
    render(<NotionImportPanel orgId="org-1" />)
    const link = screen.getByRole('link', { name: 'Notion に接続' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/api/integrations/auth/notion?orgId=org-1'))
  })
})

describe('NotionImportPanel — 接続済み・データベース一覧', () => {
  beforeEach(() => {
    sinksState.notionConnection = { connected: true, workspaceName: 'Acme' }
    connectionsState.connections = [notionConnection()]
  })

  it('取り込めるデータベースが無ければその旨を表示し、再読み込みボタンでrefetchできる', () => {
    render(<NotionImportPanel orgId="org-1" />)
    expect(screen.getByText(/取り込めるデータベースが見つかりません/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(containersState.refetch).toHaveBeenCalled()
  })

  it('データベース一覧を表示し、未設定/取り込み中のバッジをconnection.importConfigから出し分ける', () => {
    connectionsState.connections = [
      notionConnection({ importConfig: { read_container_ids: ['db-1'] } }),
    ]
    containersState.containers = [
      { id: 'db-1', title: 'タスク一覧' },
      { id: 'db-2', title: '議事録' },
    ]
    render(<NotionImportPanel orgId="org-1" />)

    expect(screen.getByText('タスク一覧')).toBeInTheDocument()
    expect(screen.getByText('議事録')).toBeInTheDocument()
    expect(screen.getByText('取り込み中')).toBeInTheDocument()
    expect(screen.getByText('未設定')).toBeInTheDocument()
  })

  it('member: 一覧の代わりに「owner/adminのみ」の案内を表示し、containers APIは呼ばない(enabled=false)', () => {
    connectionsState.viewerRole = 'member'
    render(<NotionImportPanel orgId="org-1" />)

    expect(screen.getByText(/owner\/adminのみ/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /設定/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り込みをやめる' })).not.toBeInTheDocument()
    // canManage(=false)がuseConnectionContainersのenabled引数に渡っていること(実装がAPIを
    // 呼ばないようにする経路)を直接検証する。
    expect(useConnectionContainersMock).toHaveBeenCalledWith('org-1', 'conn-notion-1', false)
  })

  it('owner: useConnectionContainersをenabled=trueで呼ぶ', () => {
    render(<NotionImportPanel orgId="org-1" />)
    expect(useConnectionContainersMock).toHaveBeenCalledWith('org-1', 'conn-notion-1', true)
  })

  it('「取り込みをやめる」はread_container_idsからそのIDだけを除いてPATCHする(optimistic)', async () => {
    connectionsState.connections = [
      notionConnection({ importConfig: { read_container_ids: ['db-1', 'db-2'] } }),
    ]
    containersState.containers = [
      { id: 'db-1', title: 'タスク一覧' },
      { id: 'db-2', title: '議事録' },
    ]
    render(<NotionImportPanel orgId="org-1" />)

    const row = screen.getByText('タスク一覧').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '取り込みをやめる' }))
    })

    expect(updateImportConfigMutateAsyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-notion-1',
      importConfig: { read_container_ids: ['db-2'] },
    })
  })

  it('最後の1件を外すと空配列のまま(未指定に化けない)でPATCHする(pruneImportConfigの罠の回帰)', async () => {
    connectionsState.connections = [notionConnection({ importConfig: { read_container_ids: ['db-1'] } })]
    containersState.containers = [{ id: 'db-1', title: 'タスク一覧' }]
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込みをやめる' }))
    })

    expect(updateImportConfigMutateAsyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-notion-1',
      importConfig: { read_container_ids: [] },
    })
  })

  it('「取り込みをやめる」が失敗したらエラートーストを表示する', async () => {
    connectionsState.connections = [notionConnection({ importConfig: { read_container_ids: ['db-1'] } })]
    containersState.containers = [{ id: 'db-1', title: 'タスク一覧' }]
    updateImportConfigMutateAsyncMock.mockRejectedValue(new Error('取り込み設定の更新に失敗しました'))
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込みをやめる' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('取り込み設定の更新に失敗しました')
  })

  it('解除後、containers一覧を再フェッチしなくてもバッジが即座に「未設定」に変わる(真実源の一本化の回帰)', async () => {
    connectionsState.connections = [notionConnection({ importConfig: { read_container_ids: ['db-1'] } })]
    containersState.containers = [{ id: 'db-1', title: 'タスク一覧' }]
    // 実際の楽観更新(useUpdateImportConfigのonMutate)を模す: connectorConnectionsキャッシュ相当の
    // connectionsState.connectionsだけを更新する。containersState(containers一覧)には一切触れない。
    updateImportConfigMutateAsyncMock.mockImplementation(
      async (input: { connectionId: string; importConfig: Record<string, unknown> }) => {
        connectionsState.connections = connectionsState.connections.map((c) =>
          c.id === input.connectionId ? { ...c, importConfig: input.importConfig } : c,
        )
        return { id: input.connectionId, importConfig: input.importConfig }
      },
    )
    const { rerender } = render(<NotionImportPanel orgId="org-1" />)
    expect(screen.getByText('取り込み中')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込みをやめる' }))
    })
    rerender(<NotionImportPanel orgId="org-1" />)

    expect(screen.getByText('未設定')).toBeInTheDocument()
    expect(screen.queryByText('取り込み中')).not.toBeInTheDocument()
  })
})

describe('NotionImportPanel — マッピングウィザード', () => {
  beforeEach(() => {
    sinksState.notionConnection = { connected: true, workspaceName: 'Acme' }
    connectionsState.connections = [notionConnection()]
    containersState.containers = [{ id: 'db-1', title: 'タスク一覧' }]
  })

  it('「設定する」でuseNotionMappingProposalをenabledで呼び、schemaの選択肢と提案の初期値を表示する', async () => {
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    expect(useNotionMappingProposalMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-notion-1',
      databaseId: 'db-1',
      enabled: true,
    })

    const dueSelect = screen.getByLabelText('期日として取り込むプロパティ') as HTMLSelectElement
    expect(dueSelect.value).toBe('due-1')
    const statusSelect = screen.getByLabelText('完了として扱うプロパティ') as HTMLSelectElement
    expect(statusSelect.value).toBe('status-1')
    expect(screen.getByRole('checkbox', { name: '未着手' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '完了' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '完了' })).toBeChecked()
    expect(screen.getByText(/タイトルはNotion側で自動的に判別する/)).toBeInTheDocument()
  })

  it('AI不調(ヒューリスティックへフォールバック)なら責めない調子で伝え、導線は止めない', async () => {
    proposalState.data = proposeResult({ proposalSource: 'heuristic', aiUnavailableReason: 'ai_unconfigured' })
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    expect(screen.getByText(/自動提案は使えませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).not.toBeDisabled()
  })

  it('checkbox型プロパティを選ぶと完了選択肢のチェック/ラジオは出さない', async () => {
    proposalState.data = proposeResult({ schema: [DATE_PROP, CHECKBOX_PROP], proposal: { due_prop_id: null, status: null } })
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    fireEvent.change(screen.getByLabelText('完了として扱うプロパティ'), { target: { value: 'done-1' } })

    expect(screen.queryByText('完了とみなす選択肢(複数可)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).not.toBeDisabled()
  })

  it('status/select型で完了選択肢を1件も選ばないと確定ボタンが無効になる(保存APIの400を先読みする)', async () => {
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    // 提案の初期値は「完了」がcheck済みなので一旦外す
    fireEvent.click(screen.getByRole('checkbox', { name: '完了' }))

    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).toBeDisabled()
  })

  it('選択肢を変更すると直前の保存エラーが消える(古いエラーが残り続けない)', async () => {
    saveMutateAsyncMock.mockRejectedValueOnce(new Error('due_prop_id: date型ではありません(id=due-1, 実際の型=select)'))
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この設定で取り込む' }))
    })
    expect(screen.getByText('due_prop_id: date型ではありません(id=due-1, 実際の型=select)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('期日として取り込むプロパティ'), { target: { value: '' } })

    expect(screen.queryByText('due_prop_id: date型ではありません(id=due-1, 実際の型=select)')).not.toBeInTheDocument()
  })

  it('「この設定で取り込む」でPUTを呼び、成功したらエディタを閉じる', async () => {
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この設定で取り込む' }))
    })

    expect(saveMutateAsyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-notion-1',
      databaseId: 'db-1',
      mapping: {
        due_prop_id: 'due-1',
        status: { prop_id: 'status-1', prop_type: 'status', done_option_ids: ['opt-done'], write_done_option_id: 'opt-done' },
      },
    })
    expect(screen.queryByLabelText('期日として取り込むプロパティ')).not.toBeInTheDocument()
  })

  it('保存中に別のDBの設定へ切り替えても、保存完了時に閉じるのは保存した本人のエディタだけ(別DBのエディタは閉じない)', async () => {
    containersState.containers = [
      { id: 'db-1', title: 'タスク一覧' },
      { id: 'db-2', title: '議事録' },
    ]
    let resolveSave: ((value: unknown) => void) | undefined
    saveMutateAsyncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    render(<NotionImportPanel orgId="org-1" />)

    const row1 = screen.getByText('タスク一覧').closest('li')!
    const row2 = screen.getByText('議事録').closest('li')!

    // db-1の設定を開いて保存する(保存は完了せず保留のまま)
    fireEvent.click(within(row1).getByRole('button', { name: '設定する' }))
    fireEvent.click(within(row1).getByRole('button', { name: 'この設定で取り込む' }))

    // db-1の保存が終わる前にdb-2の設定を開く(切り替え)
    fireEvent.click(within(row2).getByRole('button', { name: '設定する' }))
    expect(within(row2).getByLabelText('期日として取り込むプロパティ')).toBeInTheDocument()

    // db-1の保存が完了する
    await act(async () => {
      resolveSave?.({
        databaseId: 'db-1',
        mapping: { due_prop_id: 'due-1', status: null, confirmed_at: '2026-07-21T00:00:00.000Z' },
      })
    })

    // db-2のエディタは開いたまま(db-1のonSavedに巻き込まれて閉じない)
    expect(within(row2).getByLabelText('期日として取り込むプロパティ')).toBeInTheDocument()
  })

  it('保存APIが400を返したら、返ってきた理由をそのまま表示する', async () => {
    saveMutateAsyncMock.mockRejectedValue(new Error('due_prop_id: date型ではありません(id=due-1, 実際の型=select)'))
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この設定で取り込む' }))
    })

    expect(screen.getByText('due_prop_id: date型ではありません(id=due-1, 実際の型=select)')).toBeInTheDocument()
    // エラーでもエディタは閉じない(利用者が直して再送できるようにする)
    expect(screen.getByLabelText('期日として取り込むプロパティ')).toBeInTheDocument()
  })

  it('提案の取得自体が失敗したらエラーを表示する', async () => {
    proposalState.data = undefined
    proposalState.error = '接続が失効しています。再接続してください'
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    expect(screen.getByText('接続が失効しています。再接続してください')).toBeInTheDocument()
  })

  it('キャンセルでエディタを閉じる(保存は呼ばない)', async () => {
    render(<NotionImportPanel orgId="org-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByLabelText('期日として取り込むプロパティ')).not.toBeInTheDocument()
    expect(saveMutateAsyncMock).not.toHaveBeenCalled()
  })
})

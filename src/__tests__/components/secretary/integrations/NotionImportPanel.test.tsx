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
 * - 「設定する」でマッピング提案(propose)を取得し、期日/完了の対応づけを1回確認してから
 *   明示ボタンで保存する(この画面唯一の保存ボタン。他は楽観更新)
 * - AI提案が使えなかった場合は責めない調子で伝え、導線は止めない
 * - 保存APIの400エラー理由をそのまま見せる
 * - 「取り込みをやめる」はread_container_idsから外すoptimistic update
 */

const {
  sinksState,
  connectionsState,
  containersState,
  proposeMutateAsyncMock,
  saveMutateAsyncMock,
  updateImportConfigMutateAsyncMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  sinksState: { notionConnection: { connected: false, workspaceName: null as string | null } },
  connectionsState: { connections: [] as ConnectorConnection[], viewerRole: 'owner' as string | null, isLoading: false },
  containersState: {
    containers: [] as Array<{ id: string; title: string }>,
    selectedContainerIds: [] as string[],
    isLoading: false,
    error: null as string | null,
  },
  proposeMutateAsyncMock: vi.fn(),
  saveMutateAsyncMock: vi.fn(),
  updateImportConfigMutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useSinks', () => ({
  useSinks: () => sinksState,
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectors: () => connectionsState,
    useConnectionContainers: () => containersState,
    useProposeNotionMapping: () => ({ mutateAsync: proposeMutateAsyncMock, isPending: false }),
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
  containersState.selectedContainerIds = []
  containersState.isLoading = false
  containersState.error = null
  proposeMutateAsyncMock.mockResolvedValue(proposeResult())
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

  it('取り込めるデータベースが無ければその旨を表示する', () => {
    render(<NotionImportPanel orgId="org-1" />)
    expect(screen.getByText(/取り込めるデータベースが見つかりません/)).toBeInTheDocument()
  })

  it('データベース一覧を表示し、未設定/取り込み中のバッジを出し分ける', () => {
    containersState.containers = [
      { id: 'db-1', title: 'タスク一覧' },
      { id: 'db-2', title: '議事録' },
    ]
    containersState.selectedContainerIds = ['db-1']
    render(<NotionImportPanel orgId="org-1" />)

    expect(screen.getByText('タスク一覧')).toBeInTheDocument()
    expect(screen.getByText('議事録')).toBeInTheDocument()
    expect(screen.getByText('取り込み中')).toBeInTheDocument()
    expect(screen.getByText('未設定')).toBeInTheDocument()
  })

  it('member: 設定する/取り込みをやめるボタンを出さない', () => {
    connectionsState.viewerRole = 'member'
    containersState.containers = [{ id: 'db-1', title: 'タスク一覧' }]
    containersState.selectedContainerIds = ['db-1']
    render(<NotionImportPanel orgId="org-1" />)
    expect(screen.queryByRole('button', { name: /設定/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り込みをやめる' })).not.toBeInTheDocument()
  })

  it('「取り込みをやめる」はread_container_idsからそのIDだけを除いてPATCHする(optimistic)', async () => {
    connectionsState.connections = [
      notionConnection({ importConfig: { read_container_ids: ['db-1', 'db-2'] } }),
    ]
    containersState.containers = [
      { id: 'db-1', title: 'タスク一覧' },
      { id: 'db-2', title: '議事録' },
    ]
    containersState.selectedContainerIds = ['db-1', 'db-2']
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
    containersState.selectedContainerIds = ['db-1']
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
    containersState.selectedContainerIds = ['db-1']
    updateImportConfigMutateAsyncMock.mockRejectedValue(new Error('取り込み設定の更新に失敗しました'))
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込みをやめる' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('取り込み設定の更新に失敗しました')
  })
})

describe('NotionImportPanel — マッピングウィザード', () => {
  beforeEach(() => {
    sinksState.notionConnection = { connected: true, workspaceName: 'Acme' }
    connectionsState.connections = [notionConnection()]
    containersState.containers = [{ id: 'db-1', title: 'タスク一覧' }]
    containersState.selectedContainerIds = []
  })

  it('「設定する」でproposeを呼び、schemaの選択肢と提案の初期値を表示する', async () => {
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    expect(proposeMutateAsyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-notion-1',
      databaseId: 'db-1',
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
    proposeMutateAsyncMock.mockResolvedValue(
      proposeResult({ proposalSource: 'heuristic', aiUnavailableReason: 'ai_unconfigured' }),
    )
    render(<NotionImportPanel orgId="org-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    })

    expect(screen.getByText(/自動提案は使えませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).not.toBeDisabled()
  })

  it('checkbox型プロパティを選ぶと完了選択肢のチェック/ラジオは出さない', async () => {
    proposeMutateAsyncMock.mockResolvedValue(
      proposeResult({ schema: [DATE_PROP, CHECKBOX_PROP], proposal: { due_prop_id: null, status: null } }),
    )
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

  it('proposeの取得自体が失敗したらエラーを表示する', async () => {
    proposeMutateAsyncMock.mockRejectedValue(new Error('接続が失効しています。再接続してください'))
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

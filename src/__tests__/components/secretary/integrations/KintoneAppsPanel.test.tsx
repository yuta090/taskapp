import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { KintoneAppsPanel } from '@/components/secretary/integrations/KintoneAppsPanel'
import type { ConnectorConnection, ProposeKintoneMappingResult } from '@/lib/hooks/useConnectors'

/**
 * KintoneAppsPanel — 登録済みアプリの管理(追加・削除)＋マッピングウィザード。
 *
 * - 登録済みアプリ一覧の正本はimport_config.kintone_app_ids(containers一覧ではない。
 *   トークン失効で一部アプリがcontainers一覧から静かに消えても「登録されている」表示は保つ)
 * - 「設定済み/未設定」バッジの正本はimport_config.kintone_mappings[app_id]の有無のみ
 * - アプリ追加は疎通確認込みでサーバ側が行う(ここではフォーム入力の検証とmutateAsync呼び出しのみ)
 * - アプリが1件だけの間は削除ボタンを出さない(最後の1アプリは削除できない不変条件)
 * - 9個上限に達していたら追加フォームの代わりに上限案内を出す
 * - マッピングエディタ: タイトル必須・STATUS型のときだけ自由入力のdone_values/write_done_action欄
 * - canManage=falseの非管理者にはcontainers一覧を出さず(APIを呼ばず)案内だけ出す
 */

const {
  containersState,
  proposalState,
  addAppMutateAsyncMock,
  removeAppMutateAsyncMock,
  saveMutateAsyncMock,
  toastErrorMock,
  useConnectionContainersMock,
  useKintoneMappingProposalMock,
} = vi.hoisted(() => {
  const containersState = {
    containers: [] as Array<{ id: string; title: string }>,
    isLoading: false,
    error: null as string | null,
    refetch: vi.fn(),
  }
  const proposalState = {
    data: undefined as ProposeKintoneMappingResult | undefined,
    isLoading: false,
    error: null as string | null,
  }
  return {
    containersState,
    proposalState,
    addAppMutateAsyncMock: vi.fn(),
    removeAppMutateAsyncMock: vi.fn(),
    saveMutateAsyncMock: vi.fn(),
    toastErrorMock: vi.fn(),
    useConnectionContainersMock: vi.fn(() => containersState),
    useKintoneMappingProposalMock: vi.fn(() => proposalState),
  }
})

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useConnectionContainers: useConnectionContainersMock,
    useAddKintoneApp: () => ({ mutateAsync: addAppMutateAsyncMock, isPending: false }),
    useRemoveKintoneApp: () => ({ mutateAsync: removeAppMutateAsyncMock, isPending: false }),
    useKintoneMappingProposal: useKintoneMappingProposalMock,
    useSaveKintoneMapping: () => ({ mutateAsync: saveMutateAsyncMock, isPending: false }),
  }
})

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

function kintoneConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-kintone-1',
    provider: 'kintone',
    status: 'active',
    baseUrl: 'https://acme.cybozu.com',
    label: null,
    importEnabled: true,
    importConfig: { kintone_app_ids: ['5'] },
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

const TITLE_FIELD = { code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' }
const DUE_FIELD = { code: 'due', label: '期日', type: 'DATE' }
const CHOICE_STATUS_FIELD = { code: 'select_status', label: '進捗', type: 'DROP_DOWN', options: ['未着手', '完了'] }
const PROCESS_STATUS_FIELD = { code: 'workflow', label: 'プロセス', type: 'STATUS' }

function proposeResult(overrides: Partial<ProposeKintoneMappingResult> = {}): ProposeKintoneMappingResult {
  return {
    schema: [TITLE_FIELD, DUE_FIELD, CHOICE_STATUS_FIELD, PROCESS_STATUS_FIELD],
    proposal: { title_field_code: 'title', due_field_code: 'due', status: null },
    proposalSource: 'ai',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  containersState.containers = []
  containersState.isLoading = false
  containersState.error = null
  proposalState.data = undefined
  proposalState.isLoading = false
  proposalState.error = null
})

describe('KintoneAppsPanel — 権限', () => {
  it('canManage=falseの間はcontainers APIを呼ばず、案内のみ表示する', () => {
    render(<KintoneAppsPanel orgId="org-1" connection={kintoneConnection()} canManage={false} />)
    expect(screen.getByText(/owner\/admin/)).toBeInTheDocument()
    expect(useConnectionContainersMock).toHaveBeenCalledWith('org-1', 'conn-kintone-1', false)
  })
})

describe('KintoneAppsPanel — 登録済みアプリ一覧', () => {
  it('登録済みアプリ一覧の正本はkintone_app_ids(containers一覧に無くても表示する)', () => {
    containersState.containers = [] // トークン失効等でcontainers一覧から消えた想定
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5', '9'] } })}
        canManage
      />,
    )
    // タイトルが取れなければ生のapp_idを表示する。
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('containers一覧にタイトルがあればそれを表示する', () => {
    containersState.containers = [{ id: '5', title: 'タスク管理アプリ' }]
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5'] } })}
        canManage
      />,
    )
    expect(screen.getByText('タスク管理アプリ')).toBeInTheDocument()
  })

  it('設定済み/未設定バッジはkintone_mappingsの有無のみで決まる', () => {
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({
          importConfig: {
            kintone_app_ids: ['5', '9'],
            kintone_mappings: { '5': { title_field_code: 'title', due_field_code: null, status: null, confirmed_at: 'x' } },
          },
        })}
        canManage
      />,
    )
    expect(screen.getAllByText('取り込み中')).toHaveLength(1)
    expect(screen.getAllByText('未設定')).toHaveLength(1)
  })

  it('アプリが1件だけの間は削除ボタンを出さない(最後の1アプリは削除できない)', () => {
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5'] } })}
        canManage
      />,
    )
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('containers取得中(isLoading)でも一覧は表示され続け、削除・設定ボタンも操作できる', () => {
    containersState.isLoading = true
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5', '9'] } })}
        canManage
      />,
    )
    // タイトルは解決中でも行自体は出る(正本はkintone_app_idsであり、containersの完了を待たない)。
    expect(screen.getAllByRole('button', { name: '削除' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '設定する' })).toHaveLength(2)
  })

  it('containers取得がエラーでも一覧は表示され続け、削除・設定ボタンも操作できる(エラーは注記のみ)', async () => {
    containersState.error = 'kintoneに到達できませんでした(502)'
    removeAppMutateAsyncMock.mockResolvedValue({ appIds: ['9'] })
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5', '9'] } })}
        canManage
      />,
    )
    // 一覧を消さず、エラーはインライン注記として表示する(かつては一覧ごと消え、失効したアプリの
    // 削除ボタンが二度と押せなくなっていた)。
    expect(screen.getByText(/kintoneに到達できませんでした/)).toBeInTheDocument()
    const removeButtons = screen.getAllByRole('button', { name: '削除' })
    expect(removeButtons).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '設定する' })).toHaveLength(2)
    await act(async () => {
      fireEvent.click(removeButtons[0])
    })
    expect(removeAppMutateAsyncMock).toHaveBeenCalledWith({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '5' })
  })

  it('アプリが2件以上あれば削除ボタンを出し、押すとremoveApp.mutateAsyncを呼ぶ', async () => {
    removeAppMutateAsyncMock.mockResolvedValue({ appIds: ['5'] })
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5', '9'] } })}
        canManage
      />,
    )
    const removeButtons = screen.getAllByRole('button', { name: '削除' })
    expect(removeButtons).toHaveLength(2)
    await act(async () => {
      fireEvent.click(removeButtons[0])
    })
    expect(removeAppMutateAsyncMock).toHaveBeenCalledWith({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '5' })
  })

  it('削除失敗時はエラーをtoastで表示する', async () => {
    removeAppMutateAsyncMock.mockRejectedValue(new Error('最後の1つのアプリは削除できません(接続自体を削除してください)'))
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5', '9'] } })}
        canManage
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])
    })
    expect(toastErrorMock).toHaveBeenCalledWith('最後の1つのアプリは削除できません(接続自体を削除してください)')
  })
})

describe('KintoneAppsPanel — アプリの追加', () => {
  it('9個上限に達していたら追加フォームの代わりに上限案内を出す', () => {
    const nineApps = Array.from({ length: 9 }, (_, i) => String(i + 1))
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: nineApps } })}
        canManage
      />,
    )
    expect(screen.getByText(/上限に達しています/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ アプリを追加' })).not.toBeInTheDocument()
  })

  it('「+ アプリを追加」を押すとフォームが開き、「アプリを更新」の案内が出る', () => {
    render(<KintoneAppsPanel orgId="org-1" connection={kintoneConnection()} canManage />)
    fireEvent.click(screen.getByRole('button', { name: '+ アプリを追加' }))
    expect(screen.getByLabelText('追加するアプリのURLまたはアプリID')).toBeInTheDocument()
    expect(screen.getByLabelText('追加するアプリのAPIトークン')).toBeInTheDocument()
    expect(screen.getByText(/アプリを更新/)).toBeInTheDocument()
  })

  it('未入力では「追加する」を押せない', () => {
    render(<KintoneAppsPanel orgId="org-1" connection={kintoneConnection()} canManage />)
    fireEvent.click(screen.getByRole('button', { name: '+ アプリを追加' }))
    expect(screen.getByRole('button', { name: '追加する' })).toBeDisabled()
  })

  it('入力すると追加でき、addApp.mutateAsyncへappId・apiTokenを渡す', async () => {
    addAppMutateAsyncMock.mockResolvedValue({ appIds: ['5', '9'] })
    render(<KintoneAppsPanel orgId="org-1" connection={kintoneConnection()} canManage />)
    fireEvent.click(screen.getByRole('button', { name: '+ アプリを追加' }))

    fireEvent.change(screen.getByLabelText('追加するアプリのURLまたはアプリID'), {
      target: { value: 'https://acme.cybozu.com/k/9/' },
    })
    fireEvent.change(screen.getByLabelText('追加するアプリのAPIトークン'), { target: { value: 'new-token' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '追加する' }))
    })

    expect(addAppMutateAsyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-kintone-1',
      appId: '9',
      apiToken: 'new-token',
    })
  })

  it('追加失敗時はエラーをtoastで表示する', async () => {
    addAppMutateAsyncMock.mockRejectedValue(new Error('このアプリは既に登録されています'))
    render(<KintoneAppsPanel orgId="org-1" connection={kintoneConnection()} canManage />)
    fireEvent.click(screen.getByRole('button', { name: '+ アプリを追加' }))
    fireEvent.change(screen.getByLabelText('追加するアプリのURLまたはアプリID'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('追加するアプリのAPIトークン'), { target: { value: 'token' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '追加する' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('このアプリは既に登録されています')
  })
})

describe('KintoneAppsPanel — マッピングウィザード', () => {
  function openEditor() {
    render(
      <KintoneAppsPanel
        orgId="org-1"
        connection={kintoneConnection({ importConfig: { kintone_app_ids: ['5'] } })}
        canManage
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '設定する' }))
  }

  it('タイトルは必須(選択肢に「取り込まない」を出さない)', () => {
    proposalState.data = proposeResult()
    openEditor()
    const titleSelect = screen.getByLabelText('タイトルとして取り込むフィールド')
    expect(titleSelect).toHaveValue('title')
    // 「取り込まない」相当の選択肢(空値)はタイトル欄には出さない(必須のため)。
    expect(within(titleSelect).queryByRole('option', { name: '取り込まない' })).not.toBeInTheDocument()
  })

  it('完了フィールドを選ばない場合は保存できる(完了同期なしを許す)', () => {
    proposalState.data = proposeResult({ proposal: { title_field_code: 'title', due_field_code: null, status: null } })
    openEditor()
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).not.toBeDisabled()
  })

  it('選択肢系(DROP_DOWN)の完了フィールドを選ぶとチェックボックスで選ばせ、write_done_action欄は出さない', () => {
    proposalState.data = proposeResult()
    openEditor()
    fireEvent.change(screen.getByLabelText('完了として扱うフィールド'), { target: { value: 'select_status' } })
    expect(screen.getByLabelText('完了')).toBeInTheDocument()
    expect(screen.getByLabelText('未着手')).toBeInTheDocument()
    expect(screen.queryByLabelText(/書き戻すアクション名/)).not.toBeInTheDocument()
  })

  it('STATUS型の完了フィールドを選ぶと自由入力欄(done_values・write_done_action)を出す', () => {
    proposalState.data = proposeResult()
    openEditor()
    fireEvent.change(screen.getByLabelText('完了として扱うフィールド'), { target: { value: 'workflow' } })
    expect(screen.getByLabelText(/完了とみなすステータス名/)).toBeInTheDocument()
    expect(screen.getByLabelText(/書き戻すアクション名/)).toBeInTheDocument()
  })

  it('STATUS型を選んでも完了とみなすステータス名を入力するまでは保存できない', () => {
    proposalState.data = proposeResult()
    openEditor()
    fireEvent.change(screen.getByLabelText('完了として扱うフィールド'), { target: { value: 'workflow' } })
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/完了とみなすステータス名/), { target: { value: '完了' } })
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).not.toBeDisabled()
  })

  it('保存するとsave.mutateAsyncへ組み立てたmappingを渡す(STATUS型)', async () => {
    proposalState.data = proposeResult()
    saveMutateAsyncMock.mockResolvedValue({
      appId: '5',
      mapping: { title_field_code: 'title', due_field_code: 'due', status: null, confirmed_at: 'x' },
    })
    openEditor()
    fireEvent.change(screen.getByLabelText('完了として扱うフィールド'), { target: { value: 'workflow' } })
    fireEvent.change(screen.getByLabelText(/完了とみなすステータス名/), { target: { value: '完了、却下' } })
    fireEvent.change(screen.getByLabelText(/書き戻すアクション名/), { target: { value: '完了にする' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この設定で取り込む' }))
    })

    expect(saveMutateAsyncMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-kintone-1',
      appId: '5',
      mapping: {
        title_field_code: 'title',
        due_field_code: 'due',
        status: {
          field_code: 'workflow',
          field_type: 'STATUS',
          done_values: ['完了', '却下'],
          write_done_action: '完了にする',
        },
      },
    })
  })

  it('保存APIが400を返したら理由をそのまま表示する', async () => {
    proposalState.data = proposeResult()
    saveMutateAsyncMock.mockRejectedValue(new Error('due_field_code: DATE型ではありません'))
    openEditor()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この設定で取り込む' }))
    })

    expect(screen.getByText('due_field_code: DATE型ではありません')).toBeInTheDocument()
  })

  it('提案APIが失敗したらエラーを表示し、閉じるボタンを出す', () => {
    proposalState.error = '接続が失効しています。再接続してください'
    openEditor()
    expect(screen.getByText('接続が失効しています。再接続してください')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })

  it('AI提案が使えなかった場合は責めない調子で伝え、導線を止めない', () => {
    proposalState.data = proposeResult({ proposalSource: 'heuristic', aiUnavailableReason: 'ai_unconfigured' })
    openEditor()
    expect(screen.getByText(/自動提案は使えませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この設定で取り込む' })).toBeInTheDocument()
  })
})

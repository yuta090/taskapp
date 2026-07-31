import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ImportConfigEditor } from '@/components/secretary/integrations/ConnectorSyncPane'
import type { ConnectorConnection } from '@/lib/hooks/useConnectors'

/**
 * 取り込み対象の選び方 — ID手入力をやめ、実際の名前から選ぶ。
 *
 * これまでは「読み込み対象リスト(任意・カンマ区切り)」という欄に `list-id-1, list-id-2` の形で
 * **入れ物の内部IDを手入力**させていた。IDの調べ方は画面のどこにも書いておらず、事実上
 * 入力できない欄だった（利用者からの指摘）。一覧を返すAPIは既にあるので、それで名前を出して選ばせる。
 */

const { containersState, updateImportConfigMock, toastErrorMock } = vi.hoisted(() => ({
  containersState: {
    containers: [] as { id: string; title: string }[],
    selectedContainerIds: [] as string[],
    isLoading: false,
    error: null as string | null,
    refetch: vi.fn(),
  },
  updateImportConfigMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    useUpdateImportConfig: () => ({ mutateAsync: updateImportConfigMock, isPending: false }),
    useConnectionContainers: () => containersState,
  }
})

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [
      { id: 'space-1', name: '本店プロジェクト', orgId: 'org-1', orgName: 'Acme', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [],
    clientMembers: [],
    internalMembers: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

function connection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-1',
    provider: 'trello',
    status: 'active',
    baseUrl: null,
    label: null,
    importEnabled: true,
    importConfig: { target_space_id: 'space-1' },
    createdAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  } as ConnectorConnection
}

beforeEach(() => {
  vi.clearAllMocks()
  containersState.containers = [
    { id: 'board-1', title: '営業案件' },
    { id: 'board-2', title: '開発' },
  ]
  containersState.selectedContainerIds = []
  containersState.isLoading = false
  containersState.error = null
})

describe('取り込み対象の選択（ID手入力の置き換え）', () => {
  it('IDを手で入れる欄をもう出さない', () => {
    render(<ImportConfigEditor orgId="org-1" connection={connection()} canManage />)
    expect(screen.queryByLabelText(/カンマ区切り/)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/list-id/)).not.toBeInTheDocument()
  })

  it('ツールの呼び名で見出しを出す（Trelloは「ボード」）', () => {
    render(<ImportConfigEditor orgId="org-1" connection={connection()} canManage />)
    expect(screen.getByText(/取り込むボード/)).toBeInTheDocument()
  })

  it('Backlogなら「プロジェクト」と呼ぶ', () => {
    render(
      <ImportConfigEditor orgId="org-1" connection={connection({ provider: 'backlog' })} canManage />,
    )
    expect(screen.getByText(/取り込むプロジェクト/)).toBeInTheDocument()
  })

  it('実際の名前をチェックボックスで並べる', () => {
    render(<ImportConfigEditor orgId="org-1" connection={connection()} canManage />)
    expect(screen.getByRole('checkbox', { name: '営業案件' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '開発' })).toBeInTheDocument()
  })

  it('何も選んでいなければ「すべて」が対象だと伝える', () => {
    render(<ImportConfigEditor orgId="org-1" connection={connection()} canManage />)
    expect(screen.getByText(/選ばなければ、すべてが対象/)).toBeInTheDocument()
  })

  it('選ぶと、そのIDが保存される（IDは画面に出さないまま保存だけ正しく行う）', async () => {
    updateImportConfigMock.mockResolvedValue({})
    render(<ImportConfigEditor orgId="org-1" connection={connection()} canManage />)

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: '開発' }))
    })

    expect(updateImportConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        importConfig: expect.objectContaining({ read_list_ids: ['board-2'] }),
      }),
    )
  })

  it('既に選ばれているものはチェック済みで出る', () => {
    render(
      <ImportConfigEditor
        orgId="org-1"
        connection={connection({ importConfig: { target_space_id: 'space-1', read_list_ids: ['board-1'] } })}
        canManage
      />,
    )
    expect(screen.getByRole('checkbox', { name: '営業案件' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '開発' })).not.toBeChecked()
  })

  it('外すと選択から取り除かれる', async () => {
    updateImportConfigMock.mockResolvedValue({})
    render(
      <ImportConfigEditor
        orgId="org-1"
        connection={connection({ importConfig: { target_space_id: 'space-1', read_list_ids: ['board-1', 'board-2'] } })}
        canManage
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: '営業案件' }))
    })

    expect(updateImportConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        importConfig: expect.objectContaining({ read_list_ids: ['board-2'] }),
      }),
    )
  })

  it('一覧が取れないときは、黙って空にせず理由を出す（選択済みを失わせない）', () => {
    containersState.containers = []
    containersState.error = '接続が失効しています。再接続してください'
    render(
      <ImportConfigEditor
        orgId="org-1"
        connection={connection({ importConfig: { target_space_id: 'space-1', read_list_ids: ['board-1'] } })}
        canManage
      />,
    )
    expect(screen.getByText(/接続が失効しています/)).toBeInTheDocument()
  })

  it('権限が無い人には操作させない（閲覧のみ）', () => {
    render(<ImportConfigEditor orgId="org-1" connection={connection()} canManage={false} />)
    expect(screen.getByRole('checkbox', { name: '営業案件' })).toBeDisabled()
  })

  it('一覧を取りに行けないツール(multica)では、この選択自体を出さない', () => {
    render(
      <ImportConfigEditor orgId="org-1" connection={connection({ provider: 'multica' })} canManage />,
    )
    expect(screen.queryByText(/取り込む/)).not.toBeInTheDocument()
  })
})

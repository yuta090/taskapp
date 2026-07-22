import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotionImportPanel } from '@/components/secretary/integrations/NotionImportPanel'

/**
 * NotionImportPanel — 「取り込みをやめる」の lost update 回帰(実フックによる統合テスト)。
 *
 * 他のNotionImportPanelテスト(NotionImportPanel.test.tsx)は useConnectors/useUpdateImportConfig も
 * 含めて全フックをモックしているため、react-queryの実際のキャッシュ更新タイミング(onMutateが
 * 実行中フラグを立てるタイミング等)を検証できない。ここでは useConnectors/useUpdateImportConfig は
 * 実装(react-query)のまま使い、containers/propose/save/sinksだけをモックして、
 * PATCH /import-config への応答タイミングを手動制御することで「2件を連続して解除する」を
 * 実際の非同期競合として再現する(以前は行ごとに独立したmutationがクリック時点の
 * connection.importConfigの全体スナップショットから配列を組み立てており、後勝ちで片方が
 * 復活するlost updateがあった)。
 */

const { sinksState, containersState, saveMutateAsyncMock, proposalState } = vi.hoisted(() => {
  const containersState = {
    containers: [] as Array<{ id: string; title: string }>,
    isLoading: false,
    error: null as string | null,
    refetch: vi.fn(),
  }
  return {
    sinksState: { notionConnection: { connected: true, workspaceName: 'Acme' as string | null } },
    containersState,
    saveMutateAsyncMock: vi.fn(),
    proposalState: { data: undefined as unknown, isLoading: false, error: null as string | null },
  }
})

vi.mock('@/lib/hooks/useSinks', () => ({ useSinks: () => sinksState }))

vi.mock('@/lib/hooks/useConnectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useConnectors')>()
  return {
    ...actual,
    // useConnectors/useUpdateImportConfigは実装のまま(このファイルの検証対象)。
    useConnectionContainers: () => containersState,
    useNotionMappingProposal: () => proposalState,
    useSaveNotionMapping: () => ({ mutateAsync: saveMutateAsyncMock, isPending: false }),
  }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// useConnectorsのGET queryFnはAPI応答をそのままConnectorsResponseとして扱う(実APIは
// snake_case→camelCaseへ変換済みで返す)。ここではfetchを直接モックするため、実API
// (src/app/api/integrations/connections/route.ts)が返す形と同じcamelCaseで用意する。
const CONNECTION_ROW = {
  id: 'conn-notion-1',
  provider: 'notion',
  status: 'active',
  baseUrl: null,
  label: null,
  importEnabled: true,
  importConfig: { read_container_ids: ['db-1', 'db-2'] },
  createdAt: '2026-07-20T00:00:00.000Z',
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(NotionImportPanel, { orgId: 'org-1' })),
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  containersState.containers = [
    { id: 'db-1', title: 'タスク一覧' },
    { id: 'db-2', title: '議事録' },
  ]
})

describe('NotionImportPanel — 「取り込みをやめる」の lost update 回帰(実フック)', () => {
  it('2件を連続して解除しても両方が解除された状態になる(片方が復活しない)', async () => {
    const patchResolvers: Array<(value: unknown) => void> = []
    const patchBodies: Array<Record<string, unknown>> = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/integrations/connections?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ connections: [{ ...CONNECTION_ROW }], viewerRole: 'owner' }),
        })
      }
      if (url.includes('/import-config')) {
        patchBodies.push(JSON.parse((init?.body as string) ?? '{}'))
        return new Promise((resolve) => {
          patchResolvers.push(resolve)
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    renderPanel()

    const row1 = (await screen.findByText('タスク一覧')).closest('li')!
    const row2 = screen.getByText('議事録').closest('li')!

    await waitFor(() => expect(within(row1).getByText('取り込み中')).toBeInTheDocument())
    await waitFor(() => expect(within(row2).getByText('取り込み中')).toBeInTheDocument())

    // db-1を解除する
    fireEvent.click(within(row1).getByRole('button', { name: '取り込みをやめる' }))

    // 実行中(isPending)は全行の「取り込みをやめる」ボタンが無効化される(直列化)。
    await waitFor(() => expect(within(row2).getByRole('button', { name: '取り込みをやめる' })).toBeDisabled())

    // 実行中にdb-2の解除を試みても無効化されているため発火しない(PATCHは1回のまま)。
    fireEvent.click(within(row2).getByRole('button', { name: '取り込みをやめる' }))
    expect(patchResolvers).toHaveLength(1)
    expect(patchBodies[0]).toEqual({ import_config: { read_container_ids: ['db-2'] } })

    // db-1解除のPATCHが完了する
    await act(async () => {
      patchResolvers[0]({
        ok: true,
        json: async () => ({ id: 'conn-notion-1', import_config: { read_container_ids: ['db-2'] } }),
      })
    })

    await waitFor(() => expect(within(row2).getByRole('button', { name: '取り込みをやめる' })).not.toBeDisabled())
    await waitFor(() => expect(within(row1).getByText('未設定')).toBeInTheDocument())

    // db-2を解除する。送信直前の最新import_config(db-2だけ)から組み立てるので、db-1は復活しない
    // (read_container_ids: [] を送る。行ごとの独立mutationだった頃は['db-1']を送ってしまい、
    // db-1が復活するlost updateだった)。
    fireEvent.click(within(row2).getByRole('button', { name: '取り込みをやめる' }))
    await waitFor(() => expect(patchResolvers).toHaveLength(2))
    expect(patchBodies[1]).toEqual({ import_config: { read_container_ids: [] } })

    await act(async () => {
      patchResolvers[1]({
        ok: true,
        json: async () => ({ id: 'conn-notion-1', import_config: { read_container_ids: [] } }),
      })
    })

    await waitFor(() => {
      expect(within(row1).queryByText('取り込み中')).not.toBeInTheDocument()
      expect(within(row2).queryByText('取り込み中')).not.toBeInTheDocument()
    })
    expect(within(row1).getByText('未設定')).toBeInTheDocument()
    expect(within(row2).getByText('未設定')).toBeInTheDocument()
  })
})

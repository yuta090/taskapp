import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  useConnectors,
  useCreateMulticaConnection,
  useRotateMulticaSecret,
  useUpdateImportConfig,
  useConnectionContainers,
  useNotionMappingProposal,
  useSaveNotionMapping,
  type ConnectorConnection,
} from '@/lib/hooks/useConnectors'

/**
 * useConnectors系フック — /api/integrations/connections* のラッパー(双方向同期: multica/google_tasks)。
 * 一覧はreact-query(GETはsecretを返さない)。作成/ローテ/import_configは保存ボタンを持たず、
 * 呼び出し側から即時にmutateするoptimistic update(useSinks.tsと同型)。
 */

// useQueryをvi.fn(actual.useQuery)でラップし、実際の挙動は変えずに呼び出しoptions(第1引数)を
// 検査できるようにする(useUserSpaces.test.tsと同じパターン)。
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const MULTICA_CONNECTION: ConnectorConnection = {
  id: 'conn-1',
  provider: 'multica',
  status: 'active',
  baseUrl: 'https://multica.example.com',
  label: null,
  importEnabled: false,
  importConfig: {},
  createdAt: '2026-07-20T00:00:00.000Z',
}

const GTASKS_CONNECTION: ConnectorConnection = {
  id: 'conn-2',
  provider: 'google_tasks',
  status: 'active',
  baseUrl: null,
  label: null,
  importEnabled: true,
  importConfig: { target_space_id: 'space-1' },
  createdAt: '2026-07-20T00:00:00.000Z',
}

describe('useConnectors', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('org の双方向同期接続一覧とviewerRoleを取得する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ connections: [MULTICA_CONNECTION, GTASKS_CONNECTION], viewerRole: 'owner' }),
    })

    const { result } = renderHook(() => useConnectors('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.connections).toEqual([MULTICA_CONNECTION, GTASKS_CONNECTION])
    expect(result.current.viewerRole).toBe('owner')
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/connections?orgId=org-1')
  })

  it('取得失敗時はエラーメッセージを返し、connectionsは空配列', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'orgId is required' }) })

    const { result } = renderHook(() => useConnectors('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBe('orgId is required')
    expect(result.current.connections).toEqual([])
  })
})

describe('useCreateMulticaConnection', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('作成成功時に平文secretを一度だけ返し、一覧キャッシュを無効化する', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['connectorConnections', 'org-1'], { connections: [], viewerRole: 'owner' })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        connection_id: 'conn-1',
        base_url: 'https://multica.example.com',
        webhook_url: 'https://taskapp.example.com/api/connectors/multica/events',
        send_secret: 'send_abc123',
        receive_secret: 'recv_abc123',
      }),
    })

    const { result } = renderHook(() => useCreateMulticaConnection(), { wrapper })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync({ orgId: 'org-1', baseUrl: 'https://multica.example.com' })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/multica',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org_id: 'org-1', base_url: 'https://multica.example.com' }),
      }),
    )
    expect(response).toEqual({
      connectionId: 'conn-1',
      baseUrl: 'https://multica.example.com',
      webhookUrl: 'https://taskapp.example.com/api/connectors/multica/events',
      sendSecret: 'send_abc123',
      receiveSecret: 'recv_abc123',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['connectorConnections', 'org-1'] })
  })

  it('409(既に接続あり)はエラーメッセージをそのまま投げる', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'この組織には既に multica 接続があります。' }),
    })

    const { result } = renderHook(() => useCreateMulticaConnection(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orgId: 'org-1', baseUrl: 'https://multica.example.com' })
      }),
    ).rejects.toThrow('この組織には既に multica 接続があります。')
  })

  it('400(SSRF/入力不正)はエラーメッセージをそのまま投げる', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid base_url: private_ip' }),
    })

    const { result } = renderHook(() => useCreateMulticaConnection(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orgId: 'org-1', baseUrl: 'http://169.254.169.254/' })
      }),
    ).rejects.toThrow('invalid base_url: private_ip')
  })

  it('403(owner/admin外)はエラーメッセージをそのまま投げる', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Owner or admin only' }) })

    const { result } = renderHook(() => useCreateMulticaConnection(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orgId: 'org-1', baseUrl: 'https://multica.example.com' })
      }),
    ).rejects.toThrow('Owner or admin only')
  })
})

describe('useRotateMulticaSecret', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('POST rotate?direction=send を呼び、平文secretを返し一覧を無効化する', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ direction: 'send', secret: 'send_rotated' }) })

    const { result } = renderHook(() => useRotateMulticaSecret(), { wrapper })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync({ orgId: 'org-1', connectionId: 'conn-1', direction: 'send' })
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/connections/multica/conn-1/rotate?direction=send', {
      method: 'POST',
    })
    expect(response).toEqual({ direction: 'send', secret: 'send_rotated' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['connectorConnections', 'org-1'] })
  })

  it('失敗時はエラーメッセージを投げる', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Owner or admin only' }) })

    const { result } = renderHook(() => useRotateMulticaSecret(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orgId: 'org-1', connectionId: 'conn-1', direction: 'receive' })
      }),
    ).rejects.toThrow('Owner or admin only')
  })
})

describe('useUpdateImportConfig', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('optimisticにimportConfigを反映し、成功はinvalidateせずsetQueryDataで確定する', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['connectorConnections', 'org-1'], {
      connections: [GTASKS_CONNECTION],
      viewerRole: 'owner',
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { result } = renderHook(() => useUpdateImportConfig(), { wrapper })

    let mutationPromise: Promise<unknown>
    act(() => {
      mutationPromise = result.current.mutateAsync({
        orgId: 'org-1',
        connectionId: 'conn-2',
        importConfig: { target_space_id: 'space-2' },
      })
    })

    // optimistic: fetch応答を待たずに即キャッシュへ反映される
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ connections: ConnectorConnection[] }>([
        'connectorConnections',
        'org-1',
      ])
      expect(cached?.connections[0].importConfig).toEqual({ target_space_id: 'space-2' })
    })

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ id: 'conn-2', import_config: { target_space_id: 'space-2' } }),
      })
      await mutationPromise
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/conn-2/import-config',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ import_config: { target_space_id: 'space-2' } }),
      }),
    )
    // useUpdateSink と同型: onSuccess は invalidate(フル再フェッチ)ではなく setQueryData で
    // サーバ応答を突き合わせて確定する(編集ごとの GET storm/フリッカ回避)。
    expect(invalidateSpy).not.toHaveBeenCalled()
    const settled = queryClient.getQueryData<{ connections: ConnectorConnection[] }>([
      'connectorConnections',
      'org-1',
    ])
    expect(settled?.connections.find((c) => c.id === 'conn-2')?.importConfig).toEqual({
      target_space_id: 'space-2',
    })
  })

  it('失敗時はロールバックし、422のエラーメッセージを投げる', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['connectorConnections', 'org-1'], {
      connections: [GTASKS_CONNECTION],
      viewerRole: 'owner',
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: '取り込み先はこの組織のスペース/メンバーのみ指定できます' }),
    })

    const { result } = renderHook(() => useUpdateImportConfig(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          connectionId: 'conn-2',
          importConfig: { target_space_id: 'other-org-space' },
        })
      }),
    ).rejects.toThrow('取り込み先はこの組織のスペース/メンバーのみ指定できます')

    const cached = queryClient.getQueryData<{ connections: ConnectorConnection[] }>([
      'connectorConnections',
      'org-1',
    ])
    expect(cached?.connections[0].importConfig).toEqual({ target_space_id: 'space-1' })
  })

  it('400(UUID不正)はエラーメッセージを投げる', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['connectorConnections', 'org-1'], {
      connections: [GTASKS_CONNECTION],
      viewerRole: 'owner',
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'target_space_id / default_assignee_id は UUID 形式で指定してください' }),
    })

    const { result } = renderHook(() => useUpdateImportConfig(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          connectionId: 'conn-2',
          importConfig: { target_space_id: 'not-a-uuid' },
        })
      }),
    ).rejects.toThrow('target_space_id / default_assignee_id は UUID 形式で指定してください')
  })
})

describe('useConnectionContainers', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('containers/selected_container_idsを取得する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        containers: [{ id: 'db-1', title: 'タスク一覧' }],
        selected_container_ids: ['db-1'],
      }),
    })

    const { result } = renderHook(() => useConnectionContainers('org-1', 'conn-notion-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/connections/conn-notion-1/containers?org_id=org-1')
    expect(result.current.containers).toEqual([{ id: 'db-1', title: 'タスク一覧' }])
    expect(result.current.selectedContainerIds).toEqual(['db-1'])
  })

  it('connectionIdがnullの間はfetchしない', () => {
    const { result } = renderHook(() => useConnectionContainers('org-1', null), { wrapper: createWrapper() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.containers).toEqual([])
  })

  it('enabled引数がfalseの間はfetchしない(canManage=falseの非管理者ではAPIを呼ばない)', () => {
    const { result } = renderHook(() => useConnectionContainers('org-1', 'conn-notion-1', false), {
      wrapper: createWrapper(),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.containers).toEqual([])
  })

  it('失敗時はエラーメッセージを返し、containersは空配列', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: '接続が失効しています。再接続してください' }) })

    const { result } = renderHook(() => useConnectionContainers('org-1', 'conn-notion-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBe('接続が失効しています。再接続してください')
    expect(result.current.containers).toEqual([])
  })
})

describe('useNotionMappingProposal', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('enabled中にPOST proposeを呼び、schema/proposal/proposalSourceを返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        schema: [{ id: 'due-1', name: '期日', type: 'date' }],
        proposal: { due_prop_id: 'due-1', status: null },
        proposal_source: 'ai',
      }),
    })

    const { result } = renderHook(
      () =>
        useNotionMappingProposal({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/notion/mapping/propose',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org_id: 'org-1', connection_id: 'conn-notion-1', database_id: 'db-1' }),
      }),
    )
    expect(result.current.data).toEqual({
      schema: [{ id: 'due-1', name: '期日', type: 'date' }],
      proposal: { due_prop_id: 'due-1', status: null },
      proposalSource: 'ai',
      aiUnavailableReason: undefined,
    })
  })

  it('AI不調時はaiUnavailableReasonを伝える', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        schema: [],
        proposal: { due_prop_id: null, status: null },
        proposal_source: 'heuristic',
        ai_unavailable_reason: 'ai_unconfigured',
      }),
    })

    const { result } = renderHook(
      () =>
        useNotionMappingProposal({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data?.proposalSource).toBe('heuristic')
    expect(result.current.data?.aiUnavailableReason).toBe('ai_unconfigured')
  })

  it('失敗時はエラーメッセージを返す', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: '接続が失効しています。再接続してください' }) })

    const { result } = renderHook(
      () =>
        useNotionMappingProposal({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.error).toBe('接続が失効しています。再接続してください'))
  })

  it('失敗してもretryしない(fetchは1回だけ) — retry:0を継がないとLLMが2回課金される', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: '到達できませんでした' }) })

    const { result } = renderHook(
      () =>
        useNotionMappingProposal({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.error).toBe('到達できませんでした'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enabled=falseの間はfetchしない(行を展開していない間はLLMを呼ばない)', () => {
    const { result } = renderHook(
      () =>
        useNotionMappingProposal({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          enabled: false,
        }),
      { wrapper: createWrapper() },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  /**
   * ⚠ refetchOnReconnect: false が無いと、エディタを開いたままstaleTime(5分)を超えてネットワーク
   * が一瞬切れて復帰しただけでproposeが自動再実行され、①LLMが再課金される
   * ②結果をuseEffectでフォームへ書き戻すため利用者が選択中の値が黙って上書きされる、という
   * 二重の実害がある(retry:0/refetchOnWindowFocus:falseだけでは防げないv5の既定trueの穴)。
   */
  it('refetchOnReconnect: false が渡されている(再課金と選択中の値の上書きを防ぐため)', () => {
    renderHook(
      () =>
        useNotionMappingProposal({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    )
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(options.refetchOnReconnect).toBe(false)
  })

  /**
   * ⚠ これが本丸: 「開く→閉じる→もう一度開く」でも提案API(=LLM呼び出し)の呼び出しは1回だけで
   * あることを直接assertする。エディタの開閉はマウント/アンマウントに対応する(NotionImportPanel
   * がisEditingで条件付きレンダリングする)。同一QueryClientを共有した状態で
   * mount→unmount(閉じる)→再mount(もう一度開く)しても、staleTime(5分)内はreact-queryの
   * キャッシュを再利用し、再フェッチしない。以前のuseMutation+useEffect実装では、開閉のたびに
   * 必ず呼び直しており(かつreactStrictModeのeffect二重実行で1回の展開につき2回呼ばれていた)、
   * 確認のために開閉するだけでLLM課金が漏れていた。
   */
  it('開く→閉じる→もう一度開く、で提案APIの呼び出しは1回だけ(useQueryのキャッシュ再利用)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        schema: [{ id: 'due-1', name: '期日', type: 'date' }],
        proposal: { due_prop_id: 'due-1', status: null },
        proposal_source: 'ai',
      }),
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const input = {
      orgId: 'org-1',
      connectionId: 'conn-notion-1',
      databaseId: 'db-1',
      enabled: true,
    }

    // 1回目: 「設定する」で行を展開する(=エディタがマウントされる)
    const first = renderHook(() => useNotionMappingProposal(input), { wrapper })
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 閉じる(=エディタがアンマウントされる。QueryClient自体は同じインスタンスを共有し続ける
    // ので、キャッシュは消えない — 実運用でもQueryClientはコンポーネントツリーの外側に1つ)。
    first.unmount()

    // もう一度開く(=再マウント)。staleTime内なので再フェッチしない。
    const second = renderHook(() => useNotionMappingProposal(input), { wrapper })
    await waitFor(() => expect(second.result.current.data).toBeDefined())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('useSaveNotionMapping', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('PUT mappingを呼び、成功で接続一覧(import_config)だけを無効化する(containers一覧は無効化しない)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        database_id: 'db-1',
        mapping: { due_prop_id: 'due-1', status: null, confirmed_at: '2026-07-21T00:00:00.000Z' },
      }),
    })

    const { result } = renderHook(() => useSaveNotionMapping(), { wrapper })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        orgId: 'org-1',
        connectionId: 'conn-notion-1',
        databaseId: 'db-1',
        mapping: { due_prop_id: 'due-1', status: null },
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/notion/mapping',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          org_id: 'org-1',
          connection_id: 'conn-notion-1',
          database_id: 'db-1',
          mapping: { due_prop_id: 'due-1', status: null },
        }),
      }),
    )
    expect(response).toEqual({
      databaseId: 'db-1',
      mapping: { due_prop_id: 'due-1', status: null, confirmed_at: '2026-07-21T00:00:00.000Z' },
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['connectorConnections', 'org-1'] })
    // ⚠ containers一覧(Notionの/v1/search全ページ往復)は無効化しない。「取り込み中」バッジは
    // connection.importConfig.read_container_ids(上でinvalidateしたconnectorConnections)から
    // 導出する設計にしたため、バッジ更新のためだけに高コストな外部往復を走らせる必要が無い。
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['connectorContainers', 'org-1', 'conn-notion-1'] })
  })

  it('保存APIが400を返したら理由をそのまま投げる(利用者にどのプロパティが不正か伝えるため)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'due_prop_id: date型ではありません(id=due-1, 実際の型=select)' }),
    })

    const { result } = renderHook(() => useSaveNotionMapping(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          connectionId: 'conn-notion-1',
          databaseId: 'db-1',
          mapping: { due_prop_id: 'due-1', status: null },
        })
      }),
    ).rejects.toThrow('due_prop_id: date型ではありません(id=due-1, 実際の型=select)')
  })
})

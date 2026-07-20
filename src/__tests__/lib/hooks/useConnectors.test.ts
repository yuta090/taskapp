import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useConnectors,
  useCreateMulticaConnection,
  useRotateMulticaSecret,
  useUpdateImportConfig,
  type ConnectorConnection,
} from '@/lib/hooks/useConnectors'

/**
 * useConnectors系フック — /api/integrations/connections* のラッパー(双方向同期: multica/google_tasks)。
 * 一覧はreact-query(GETはsecretを返さない)。作成/ローテ/import_configは保存ボタンを持たず、
 * 呼び出し側から即時にmutateするoptimistic update(useSinks.tsと同型)。
 */

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
  importEnabled: false,
  importConfig: {},
  createdAt: '2026-07-20T00:00:00.000Z',
}

const GTASKS_CONNECTION: ConnectorConnection = {
  id: 'conn-2',
  provider: 'google_tasks',
  status: 'active',
  baseUrl: null,
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

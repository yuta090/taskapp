import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useSinks,
  useCreateSink,
  useCreateNotionSink,
  useCreateGoogleSheetsSink,
  useUpdateSink,
  useTestSinkDelivery,
  useRedeliverSink,
  type SinkMeta,
} from '@/lib/hooks/useSinks'

/**
 * useSinks系フック — /api/integrations/sinks* のラッパー。
 * 一覧はreact-query、更新系(有効/無効・イベント購読・URL・secretローテーション)は
 * optimistic updateし失敗時にロールバックする(docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4)。
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const SINK: SinkMeta = {
  id: 'sink-1',
  orgId: 'org-1',
  groupId: null,
  provider: 'webhook',
  displayName: '自社Webhook',
  config: { url: 'https://example.com/hook' },
  connectionId: null,
  events: ['task.created', 'task.done', 'task.dismissed'],
  status: 'active',
  consecutiveFailures: 0,
  lastDeliveredAt: null,
  createdBy: 'user-1',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  lastDelivery: null,
}

describe('useSinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('org のsink一覧とviewerRoleを取得する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sinks: [SINK], viewerRole: 'owner' }),
    })

    const { result } = renderHook(() => useSinks('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.sinks).toEqual([SINK])
    expect(result.current.viewerRole).toBe('owner')
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/sinks?orgId=org-1')
  })

  it('notionConnectionを取得する（未接続時はデフォルトでconnected:false）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sinks: [], viewerRole: 'owner' }),
    })
    const { result } = renderHook(() => useSinks('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.notionConnection).toEqual({ connected: false, workspaceName: null })
  })

  it('notionConnectionが接続済みならworkspaceNameを含めて返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sinks: [],
        viewerRole: 'owner',
        notionConnection: { connected: true, workspaceName: 'Acme Workspace' },
      }),
    })
    const { result } = renderHook(() => useSinks('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.notionConnection).toEqual({ connected: true, workspaceName: 'Acme Workspace' })
  })

  it('取得失敗時はエラーメッセージを返す', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Internal members only' }) })

    const { result } = renderHook(() => useSinks('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBe('Internal members only')
    expect(result.current.sinks).toEqual([])
  })

  it('googleSheetsConnectionを取得する（未接続時はデフォルトでconnected:false）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sinks: [], viewerRole: 'owner' }),
    })
    const { result } = renderHook(() => useSinks('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.googleSheetsConnection).toEqual({ connected: false })
  })

  it('googleSheetsConnectionが接続済みならconnected:trueを返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sinks: [],
        viewerRole: 'owner',
        googleSheetsConnection: { connected: true },
      }),
    })
    const { result } = renderHook(() => useSinks('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.googleSheetsConnection).toEqual({ connected: true })
  })
})

describe('useCreateSink', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('作成成功時にsecretを一度だけ返し、一覧キャッシュへ追記する', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sink: SINK, secret: 'whsec_abc123' }),
    })

    const { result } = renderHook(() => useCreateSink(), { wrapper })

    let response: { sink: SinkMeta; secret: string } | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        orgId: 'org-1',
        displayName: '自社Webhook',
        url: 'https://example.com/hook',
        events: ['task.created', 'task.done', 'task.dismissed'],
      })
    })

    expect(response?.secret).toBe('whsec_abc123')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/sinks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orgId: 'org-1',
          groupId: null,
          provider: 'webhook',
          displayName: '自社Webhook',
          config: { url: 'https://example.com/hook' },
          events: ['task.created', 'task.done', 'task.dismissed'],
        }),
      }),
    )

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks).toHaveLength(1)
    expect(cached?.sinks[0].id).toBe('sink-1')
  })

  it('作成失敗時はエラーを投げ、キャッシュを変更しない', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid webhook url: ip_denied' }) })

    const { result } = renderHook(() => useCreateSink(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          displayName: 'x',
          url: 'http://169.254.169.254/',
          events: ['task.created'],
        })
      }),
    ).rejects.toThrow('invalid webhook url: ip_denied')

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks).toHaveLength(0)
  })
})

describe('useCreateNotionSink', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('POSTs provider=notion with config.database_id and returns the sink without a secret', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const NOTION_SINK: SinkMeta = { ...SINK, id: 'sink-2', provider: 'notion', config: { database_id: 'db-1' } }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sink: NOTION_SINK }) })

    const { result } = renderHook(() => useCreateNotionSink(), { wrapper })

    let response: { sink: SinkMeta } | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        orgId: 'org-1',
        displayName: 'Notion連携',
        databaseId: 'db-1',
        events: ['task.created'],
      })
    })

    expect(response?.sink.id).toBe('sink-2')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/sinks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orgId: 'org-1',
          groupId: null,
          provider: 'notion',
          displayName: 'Notion連携',
          config: { database_id: 'db-1' },
          events: ['task.created'],
        }),
      }),
    )

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks).toHaveLength(1)
    expect(cached?.sinks[0].id).toBe('sink-2')
  })

  it('作成失敗時はエラーを投げ、キャッシュを変更しない', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'notion_not_connected' }) })

    const { result } = renderHook(() => useCreateNotionSink(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          displayName: 'x',
          databaseId: 'db-1',
          events: ['task.created'],
        })
      }),
    ).rejects.toThrow('notion_not_connected')

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks).toHaveLength(0)
  })
})

describe('useCreateGoogleSheetsSink', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('POSTs provider=google_sheets with config.spreadsheet_id/sheet_name and returns the sink without a secret', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const SHEETS_SINK: SinkMeta = {
      ...SINK,
      id: 'sink-3',
      provider: 'google_sheets',
      config: { spreadsheet_id: 'sheet-abc', sheet_name: 'タスク' },
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sink: SHEETS_SINK }) })

    const { result } = renderHook(() => useCreateGoogleSheetsSink(), { wrapper })

    let response: { sink: SinkMeta } | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        orgId: 'org-1',
        displayName: 'Sheets連携',
        spreadsheetId: 'sheet-abc',
        sheetName: 'タスク',
        events: ['task.created'],
      })
    })

    expect(response?.sink.id).toBe('sink-3')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/sinks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orgId: 'org-1',
          groupId: null,
          provider: 'google_sheets',
          displayName: 'Sheets連携',
          config: { spreadsheet_id: 'sheet-abc', sheet_name: 'タスク' },
          events: ['task.created'],
        }),
      }),
    )

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks).toHaveLength(1)
    expect(cached?.sinks[0].id).toBe('sink-3')
  })

  it('作成失敗時はエラーを投げ、キャッシュを変更しない', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'google_sheets_not_connected' }) })

    const { result } = renderHook(() => useCreateGoogleSheetsSink(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          displayName: 'x',
          spreadsheetId: 'sheet-abc',
          sheetName: 'タスク',
          events: ['task.created'],
        })
      }),
    ).rejects.toThrow('google_sheets_not_connected')

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks).toHaveLength(0)
  })
})

describe('useUpdateSink', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('status変更をoptimisticに反映し、成功レスポンスで確定する', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [SINK], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { result } = renderHook(() => useUpdateSink(), { wrapper })

    let mutationPromise: Promise<unknown>
    act(() => {
      mutationPromise = result.current.mutateAsync({ orgId: 'org-1', sinkId: 'sink-1', status: 'disabled' })
    })

    // optimistic: fetchの応答を待たずに即disabledへ反映される
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
      expect(cached?.sinks[0].status).toBe('disabled')
    })

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ sink: { ...SINK, status: 'disabled' } }) })
      await mutationPromise
    })

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks[0].status).toBe('disabled')
  })

  it('失敗時はロールバックする', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [SINK], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Owner or admin only' }) })

    const { result } = renderHook(() => useUpdateSink(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orgId: 'org-1', sinkId: 'sink-1', status: 'disabled' })
      }),
    ).rejects.toThrow('Owner or admin only')

    const cached = queryClient.getQueryData<{ sinks: SinkMeta[] }>(['integrationSinks', 'org-1'])
    expect(cached?.sinks[0].status).toBe('active')
  })

  it('configを直接指定するとPATCHボディにそのまま渡す(notionのdatabase_id更新用)', async () => {
    const NOTION_SINK: SinkMeta = { ...SINK, id: 'sink-2', provider: 'notion', config: { database_id: 'db-1' } }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [NOTION_SINK], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sink: { ...NOTION_SINK, config: { database_id: 'db-2' } } }) })

    const { result } = renderHook(() => useUpdateSink(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ orgId: 'org-1', sinkId: 'sink-2', config: { database_id: 'db-2' } })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/sinks/sink-2',
      expect.objectContaining({ body: JSON.stringify({ config: { database_id: 'db-2' } }) }),
    )
  })

  it('rotateSecretを指定するとPATCHボディにrotateSecret:trueを含め、返ってきたsecretを返す', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['integrationSinks', 'org-1'], { sinks: [SINK], viewerRole: 'owner' })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sink: SINK, secret: 'whsec_rotated' }),
    })

    const { result } = renderHook(() => useUpdateSink(), { wrapper })

    let response: { sink: SinkMeta; secret?: string } | undefined
    await act(async () => {
      response = await result.current.mutateAsync({ orgId: 'org-1', sinkId: 'sink-1', rotateSecret: true })
    })

    expect(response?.secret).toBe('whsec_rotated')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/sinks/sink-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ rotateSecret: true }),
      }),
    )
  })
})

describe('useTestSinkDelivery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST /sinks/[id]/test を呼び、結果を返す(outcomeは webhook/notion共通の文字列形状)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ deliveryId: 'd-1', outcome: 'sent', responseStatus: 200 }),
    })
    const { result } = renderHook(() => useTestSinkDelivery(), { wrapper: createWrapper() })

    let response: unknown
    await act(async () => {
      response = await result.current.mutateAsync('sink-1')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/sinks/sink-1/test', { method: 'POST' })
    expect(response).toEqual({ deliveryId: 'd-1', outcome: 'sent', responseStatus: 200 })
  })

  it('失敗時はerror文字列を含めて返す(notion由来)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ deliveryId: null, outcome: 'failed', responseStatus: 401, error: 'unauthorized' }),
    })
    const { result } = renderHook(() => useTestSinkDelivery(), { wrapper: createWrapper() })

    let response: unknown
    await act(async () => {
      response = await result.current.mutateAsync('sink-2')
    })

    expect(response).toEqual({ deliveryId: null, outcome: 'failed', responseStatus: 401, error: 'unauthorized' })
  })
})

describe('useRedeliverSink', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST /sinks/[id]/redeliver を呼び、件数を返す', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, count: 3 }) })
    const { result } = renderHook(() => useRedeliverSink(), { wrapper: createWrapper() })

    let response: { ok: boolean; count: number } | undefined
    await act(async () => {
      response = await result.current.mutateAsync({ orgId: 'org-1', sinkId: 'sink-1' })
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/sinks/sink-1/redeliver', { method: 'POST' })
    expect(response?.count).toBe(3)
  })
})

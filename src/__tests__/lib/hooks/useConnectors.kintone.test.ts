import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  useAddKintoneApp,
  useRemoveKintoneApp,
  useKintoneMappingProposal,
  useSaveKintoneMapping,
} from '@/lib/hooks/useConnectors'

/**
 * kintone専用フック(アプリの追加・削除・マッピングウィザード)。
 * useConnectors.test.tsのNotion版と同じ設計・同じテスト観点(retry:0・containers invalidateの
 * 有無・秘密を含まない応答)を kintone に合わせて固定する。
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

describe('useAddKintoneApp', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('POST apps を呼び、成功で接続一覧を無効化する(containers一覧はinvalidateしない — 表示速度是正)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ app_ids: ['5', '9'] }) })

    const { result } = renderHook(() => useAddKintoneApp(), { wrapper })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        orgId: 'org-1',
        connectionId: 'conn-kintone-1',
        appId: '9',
        apiToken: 'new-token',
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/kintone/apps',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          org_id: 'org-1',
          connection_id: 'conn-kintone-1',
          app_id: '9',
          api_token: 'new-token',
        }),
      }),
    )
    expect(response).toEqual({ appIds: ['5', '9'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['connectorConnections', 'org-1'] })
    // ⚠ アプリの追加はfetchAppFields(schemaのみ・アプリ名を持たない)にしか到達しないため、
    // containers一覧(listContainers。最大9アプリぶんの直列外部往復)を無効化しても新しい
    // アプリのタイトルは得られない。KintoneAppsPanel.tsxの修正(登録済みアプリ一覧の正本を
    // kintone_app_idsにする)により生のapp_idで表示しても壊れないため、無効化はしない。
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['connectorContainers', 'org-1', 'conn-kintone-1'] })
  })

  it('失敗時はエラーメッセージを投げる(平文トークンはエラーに含まれない)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'このアプリは既に登録されています' }) })

    const { result } = renderHook(() => useAddKintoneApp(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          connectionId: 'conn-kintone-1',
          appId: '9',
          apiToken: 'secret-token',
        })
      }),
    ).rejects.toThrow('このアプリは既に登録されています')
  })
})

describe('useRemoveKintoneApp', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('DELETE apps を呼び、成功で接続一覧を無効化し、containers一覧は再取得せずキャッシュから該当アプリを取り除く', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    // containers一覧が既に(タイトル解決のため)取得済みの状態を再現する。
    queryClient.setQueryData(['connectorContainers', 'org-1', 'conn-kintone-1'], {
      containers: [
        { id: '5', title: 'アプリ5' },
        { id: '9', title: 'アプリ9' },
      ],
      selected_container_ids: [],
    })

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ app_ids: ['5'] }) })

    const { result } = renderHook(() => useRemoveKintoneApp(), { wrapper })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9' })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1) // containers再取得は起きない(fetchはDELETEの1回だけ)。
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/kintone/apps',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ org_id: 'org-1', connection_id: 'conn-kintone-1', app_id: '9' }),
      }),
    )
    expect(response).toEqual({ appIds: ['5'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['connectorConnections', 'org-1'] })
    // containers一覧はinvalidate(=外部往復を伴う再取得)されない。
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['connectorContainers', 'org-1', 'conn-kintone-1'] })
    // 削除したアプリ(9)だけがキャッシュから取り除かれ、外部往復ゼロで整合する。
    expect(queryClient.getQueryData(['connectorContainers', 'org-1', 'conn-kintone-1'])).toEqual({
      containers: [{ id: '5', title: 'アプリ5' }],
      selected_container_ids: [],
    })
  })

  it('containers一覧が未取得(undefined)のときは何もしない(取得していない状態にキャッシュを作らない)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ app_ids: ['5'] }) })

    const { result } = renderHook(() => useRemoveKintoneApp(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9' })
    })

    expect(queryClient.getQueryData(['connectorContainers', 'org-1', 'conn-kintone-1'])).toBeUndefined()
  })

  it('失敗時はエラーメッセージを投げる', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: '最後の1つのアプリは削除できません(接続自体を削除してください)' }),
    })

    const { result } = renderHook(() => useRemoveKintoneApp(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '5' })
      }),
    ).rejects.toThrow('最後の1つのアプリは削除できません(接続自体を削除してください)')
  })
})

describe('useKintoneMappingProposal', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('enabled中にPOST proposeを呼び、schema/proposal/proposalSourceを返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        schema: [{ code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' }],
        proposal: { title_field_code: 'title', due_field_code: null, status: null },
        proposal_source: 'ai',
      }),
    })

    const { result } = renderHook(
      () =>
        useKintoneMappingProposal({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9', enabled: true }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/kintone/mapping/propose',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org_id: 'org-1', connection_id: 'conn-kintone-1', app_id: '9' }),
      }),
    )
    expect(result.current.data).toEqual({
      schema: [{ code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' }],
      proposal: { title_field_code: 'title', due_field_code: null, status: null },
      proposalSource: 'ai',
      aiUnavailableReason: undefined,
    })
  })

  it('失敗してもretryしない(fetchは1回だけ) — retry:0を継がないとLLMが2回課金される', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: '到達できませんでした' }) })

    const { result } = renderHook(
      () =>
        useKintoneMappingProposal({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9', enabled: true }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.error).toBe('到達できませんでした'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enabled=falseの間はfetchしない(行を展開していない間はLLMを呼ばない)', () => {
    const { result } = renderHook(
      () =>
        useKintoneMappingProposal({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9', enabled: false }),
      { wrapper: createWrapper() },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  /**
   * ⚠ useNotionMappingProposalと同じ理由。refetchOnReconnect: false が無いと、エディタを開いた
   * ままstaleTime(5分)を超えてネットワークが一瞬切れて復帰しただけでproposeが自動再実行され、
   * LLM再課金＋選択中の値の上書きという二重の実害が起きる。
   */
  it('refetchOnReconnect: false が渡されている(再課金と選択中の値の上書きを防ぐため)', () => {
    renderHook(
      () =>
        useKintoneMappingProposal({ orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9', enabled: true }),
      { wrapper: createWrapper() },
    )
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(options.refetchOnReconnect).toBe(false)
  })

  /**
   * ⚠ 開く→閉じる→もう一度開く、で提案APIの呼び出しは1回だけ(useQueryのキャッシュ再利用。
   * useNotionMappingProposalと同じ回帰テスト)。
   */
  it('開く→閉じる→もう一度開く、で提案APIの呼び出しは1回だけ(useQueryのキャッシュ再利用)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        schema: [{ code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' }],
        proposal: { title_field_code: 'title', due_field_code: null, status: null },
        proposal_source: 'ai',
      }),
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const input = { orgId: 'org-1', connectionId: 'conn-kintone-1', appId: '9', enabled: true }

    const first = renderHook(() => useKintoneMappingProposal(input), { wrapper })
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    first.unmount()

    const second = renderHook(() => useKintoneMappingProposal(input), { wrapper })
    await waitFor(() => expect(second.result.current.data).toBeDefined())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('useSaveKintoneMapping', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('PUT mappingを呼び、成功で接続一覧だけを無効化する(containers一覧は無効化しない)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        app_id: '9',
        mapping: {
          title_field_code: 'title',
          due_field_code: 'due',
          status: null,
          confirmed_at: '2026-07-23T00:00:00.000Z',
        },
      }),
    })

    const { result } = renderHook(() => useSaveKintoneMapping(), { wrapper })

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
    await act(async () => {
      response = await result.current.mutateAsync({
        orgId: 'org-1',
        connectionId: 'conn-kintone-1',
        appId: '9',
        mapping: { title_field_code: 'title', due_field_code: 'due', status: null },
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/connections/kintone/mapping',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          org_id: 'org-1',
          connection_id: 'conn-kintone-1',
          app_id: '9',
          mapping: { title_field_code: 'title', due_field_code: 'due', status: null },
        }),
      }),
    )
    expect(response).toEqual({
      appId: '9',
      mapping: {
        title_field_code: 'title',
        due_field_code: 'due',
        status: null,
        confirmed_at: '2026-07-23T00:00:00.000Z',
      },
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['connectorConnections', 'org-1'] })
    // ⚠ マッピング確定は登録済みアプリの集合(kintone_app_ids)を変えないため、高コストな
    // containers一覧(listContainers)は無効化しない。
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['connectorContainers', 'org-1', 'conn-kintone-1'] })
  })

  it('保存APIが400を返したら理由をそのまま投げる', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'due_field_code: DATE型ではありません(code=due, 実際の型=SINGLE_LINE_TEXT)' }),
    })

    const { result } = renderHook(() => useSaveKintoneMapping(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orgId: 'org-1',
          connectionId: 'conn-kintone-1',
          appId: '9',
          mapping: { title_field_code: 'title', due_field_code: 'due', status: null },
        })
      }),
    ).rejects.toThrow('due_field_code: DATE型ではありません(code=due, 実際の型=SINGLE_LINE_TEXT)')
  })
})

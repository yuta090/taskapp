import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { useFiles, useUpdateFile, filesQueryKey, type ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 前のバージョンでは一覧のキャッシュが「配列」だった。キーを版数化して形を変えたので、
 * 再訪ユーザーのブラウザには古い形のキャッシュが残っている。
 * 更新処理がそれを掴むと、画面は変わったように見えて保存されない(=黙って失敗する)。
 */

const LEGACY_KEY = ['files', 'space-1']
const OTHER_SPACE_LEGACY_KEY = ['files', 'space-2']
const fetchMock = vi.fn()

function makeFile(): ProjectFile {
  return {
    id: 'f1',
    name: '要件定義書.pdf',
    description: null,
    mimeType: 'application/pdf',
    sizeBytes: 100,
    origin: 'internal',
    clientVisible: false,
    uploadedBy: 'u1',
    uploaderName: '田中太郎',
    createdAt: '2026-07-01T00:00:00',
  }
}

function wrap(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'W'
  return Wrapper
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('古い形のキャッシュが残っていても壊れない', () => {
  it('保存は古い形のキャッシュに触らず、ちゃんとAPIを呼ぶ', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    // 旧バージョンの永続キャッシュ(配列形状)
    client.setQueryData(LEGACY_KEY, [makeFile()])
    client.setQueryData(filesQueryKey('space-1'), { files: [makeFile()], hasMore: false })

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ file: { id: 'f1', client_visible: true } }),
    })

    const { result } = renderHook(() => useUpdateFile(), { wrapper: wrap(client) })

    act(() => {
      result.current.mutate({ spaceId: 'space-1', fileId: 'f1', clientVisible: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      client.getQueryData<{ files: ProjectFile[] }>(filesQueryKey('space-1'))?.files[0].clientVisible
    ).toBe(true)
  })

  /**
   * 掃除は「復元が終わったあと」でなければ意味がない。
   * 永続キャッシュの復元は非同期で、子の mount effect のほうが先に走るため、
   * 素直に消すと「消す → そのあと復元で復活」になって空振りする。
   * ここは本番と同じ順序(PersistQueryClientProvider ごしの復元)で確かめる。
   */
  it('復元で古い形のキャッシュが戻ってきても、開いたあとに捨てる', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [], hasMore: false }) })

    // 復元は非同期。この間 useFiles は既にマウントされている
    const restored: PersistedClient = {
      timestamp: Date.now(),
      buster: '',
      clientState: {
        mutations: [],
        queries: [
          // 掃除の対象外。これが残ることで「復元が本当に効いている」ことを裏取りする
          // (復元が効いていないと、掃除が空振りでもテストが通ってしまう)
          {
            queryKey: OTHER_SPACE_LEGACY_KEY,
            queryHash: JSON.stringify(OTHER_SPACE_LEGACY_KEY),
            state: {
              data: [makeFile()],
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {
            queryKey: LEGACY_KEY,
            queryHash: JSON.stringify(LEGACY_KEY),
            state: {
              data: [makeFile()],
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
      },
    }
    const persister = {
      persistClient: async () => {},
      restoreClient: async () => restored,
      removeClient: async () => {},
    }

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <PersistQueryClientProvider client={client} persistOptions={{ persister, buster: '' }}>
        {children}
      </PersistQueryClientProvider>
    )
    Wrapper.displayName = 'PersistWrapper'

    renderHook(() => useFiles('space-1'), { wrapper: Wrapper })

    // まず復元が効いていること(別スペースの旧キーが戻ってきている)
    await waitFor(() => {
      expect(client.getQueryData(OTHER_SPACE_LEGACY_KEY)).toBeDefined()
    })

    // そのうえで、開いたスペースの旧キーは捨てられていること
    await waitFor(() => {
      expect(client.getQueryData(LEGACY_KEY)).toBeUndefined()
    })
  })
})

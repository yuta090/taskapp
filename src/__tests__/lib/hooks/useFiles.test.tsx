import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { useFiles, filesQueryKey, type ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 読み込み中の判定。
 * react-query の isLoading は「未取得 かつ 通信中」なので、IDB からキャッシュを
 * 戻している最中(通信していない)は false になり、実際はファイルがあるのに
 * 一瞬「ファイルはまだありません」が出てしまう。useTasks と同じ isPending && !data で判定する。
 */

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

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function plainWrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'PlainWrapper'
  return Wrapper
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useFiles の読み込み判定', () => {
  it('キャッシュの復元がまだ終わっていないときも読み込み中にする', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const client = makeClient()
    // 復元が終わらない persister。この間クエリは「通信していない未取得」になる
    const persister = {
      persistClient: async () => {},
      restoreClient: () => new Promise<undefined>(() => {}),
      removeClient: async () => {},
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PersistQueryClientProvider client={client} persistOptions={{ persister }}>
        {children}
      </PersistQueryClientProvider>
    )

    const { result } = renderHook(() => useFiles('space-1'), { wrapper })

    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })

  it('キャッシュがあるときは読み込み中にしない', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const client = makeClient()
    client.setQueryData(filesQueryKey('space-1'), { files: [makeFile()], hasMore: false })

    const { result } = renderHook(() => useFiles('space-1'), { wrapper: plainWrapper(client) })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toHaveLength(1)
  })

  it('spaceId がまだ無いときは読み込み中にしない(永遠に読み込み中にならない)', () => {
    const client = makeClient()

    const { result } = renderHook(() => useFiles(undefined), { wrapper: plainWrapper(client) })

    expect(result.current.isLoading).toBe(false)
  })

  it('キャッシュも取得結果もまだ無いときは読み込み中にする', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const client = makeClient()

    const { result } = renderHook(() => useFiles('space-1'), { wrapper: plainWrapper(client) })

    expect(result.current.isLoading).toBe(true)
  })
})

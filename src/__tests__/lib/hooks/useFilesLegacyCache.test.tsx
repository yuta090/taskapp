import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFiles, useUpdateFile, filesQueryKey, type ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 前のバージョンでは一覧のキャッシュが「配列」だった。キーを版数化して形を変えたので、
 * 再訪ユーザーのブラウザには古い形のキャッシュが残っている。
 * 更新処理がそれを掴むと、画面は変わったように見えて保存されない(=黙って失敗する)。
 */

const LEGACY_KEY = ['files', 'space-1']
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

  it('一覧を開いたら、古い形のキャッシュは捨てる(IDBに残り続けないように)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(LEGACY_KEY, [makeFile()])
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [], hasMore: false }) })

    renderHook(() => useFiles('space-1'), { wrapper: wrap(client) })

    await waitFor(() => {
      expect(client.getQueryData(LEGACY_KEY)).toBeUndefined()
    })
  })
})

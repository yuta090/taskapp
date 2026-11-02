import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDeleteFiles, filesQueryKey, type ProjectFile } from '@/lib/hooks/useFiles'

/**
 * まとめて削除は1件ずつ既存の DELETE を呼ぶ(権限確認をサーバー側の1か所に保つため)。
 * 途中で失敗しても残りは続け、どれが消えてどれが残ったかを返す。
 */

const fetchMock = vi.fn()

function okResponse() {
  return { ok: true, json: async () => ({ ok: true }) }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useDeleteFiles(), { wrapper })
  return { client, result, invalidate }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useDeleteFiles', () => {
  it('選んだファイルを1件ずつ DELETE し、一覧の取り直しは最後の1回だけ', async () => {
    fetchMock.mockImplementation(async () => okResponse())
    const { result, invalidate } = setup()

    let outcome
    await act(async () => {
      outcome = await result.current.mutateAsync({ spaceId: 'space-1', fileIds: ['f1', 'f2', 'f3'] })
    })

    expect(outcome).toEqual({ deletedIds: ['f1', 'f2', 'f3'], failedIds: [] })
    expect(fetchMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      '/api/files/f1',
      '/api/files/f2',
      '/api/files/f3',
    ])
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'DELETE' })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('1件失敗しても残りは消し、失敗した分を返す', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/f2') ? { ok: false, json: async () => ({ error: 'Access denied' }) } : okResponse()
    )
    const { result, invalidate } = setup()

    let outcome
    await act(async () => {
      outcome = await result.current.mutateAsync({ spaceId: 'space-1', fileIds: ['f1', 'f2', 'f3'] })
    })

    expect(outcome).toEqual({ deletedIds: ['f1', 'f3'], failedIds: ['f2'] })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('通信が切れて fetch 自体が落ちても、失敗として返す', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = setup()

    let outcome
    await act(async () => {
      outcome = await result.current.mutateAsync({ spaceId: 'space-1', fileIds: ['f1'] })
    })

    expect(outcome).toEqual({ deletedIds: [], failedIds: ['f1'] })
  })

  it('取り直しを待たずに、消えた分だけ手元の一覧から外す', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/f2') ? { ok: false, json: async () => ({ error: 'Access denied' }) } : okResponse()
    )
    const { client, result } = setup()
    const makeFile = (id: string) => ({ id }) as ProjectFile
    client.setQueryData(filesQueryKey('space-1'), { files: [makeFile('f1'), makeFile('f2')], hasMore: false })

    await act(async () => {
      await result.current.mutateAsync({ spaceId: 'space-1', fileIds: ['f1', 'f2'] })
    })

    const page = client.getQueryData<{ files: ProjectFile[] }>(filesQueryKey('space-1'))
    expect(page?.files.map((file) => file.id)).toEqual(['f2'])
  })

  it('1件終わるごとに進み具合を知らせる', async () => {
    fetchMock.mockImplementation(async () => okResponse())
    const { result } = setup()
    const onProgress = vi.fn()

    await act(async () => {
      await result.current.mutateAsync({ spaceId: 'space-1', fileIds: ['f1', 'f2'], onProgress })
    })

    expect(onProgress.mock.calls).toEqual([[1], [2]])
  })

  it('同時に送るのは5件まで', async () => {
    let running = 0
    let peak = 0
    fetchMock.mockImplementation(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
      return okResponse()
    })
    const { result } = setup()

    await act(async () => {
      await result.current.mutateAsync({
        spaceId: 'space-1',
        fileIds: Array.from({ length: 12 }, (_, i) => `f${i}`),
      })
    })

    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(peak).toBe(5)
  })
})

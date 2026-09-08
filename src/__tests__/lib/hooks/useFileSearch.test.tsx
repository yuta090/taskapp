import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFileSearch, useFiles, filesQueryKey } from '@/lib/hooks/useFiles'

/**
 * 500件を超えるスペースでは、絞り込みをサーバーに投げて古いファイルも探せるようにする。
 * 通常の全件取得とはキャッシュを分ける(検索するたびに全件のキャッシュを壊さない)。
 */

const fetchMock = vi.fn()

function okFiles(files: unknown[], hasMore = false) {
  return { ok: true, json: () => Promise.resolve({ files, hasMore }) }
}

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'QueryWrapper'
  return Wrapper
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useFiles の hasMore', () => {
  it('まだ続きがあるときは hasMore を返す', async () => {
    fetchMock.mockResolvedValue(okFiles([], true))
    const { result } = renderHook(() => useFiles('space-1'), { wrapper: wrapper(makeClient()) })

    await waitFor(() => expect(result.current.hasMore).toBe(true))
  })
})

describe('useFileSearch', () => {
  it('条件を絞り込みのクエリ文字列にして問い合わせる', async () => {
    fetchMock.mockResolvedValue(okFiles([]))
    renderHook(
      () => useFileSearch('space-1', { q: '請求 書', kind: 'table', visibility: 'visible' }, { enabled: true }),
      { wrapper: wrapper(makeClient()) }
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost')
    expect(url.searchParams.get('spaceId')).toBe('space-1')
    // 空白や日本語がURLを壊さず、そのまま読み戻せること
    expect(url.searchParams.get('q')).toBe('請求 書')
    expect(url.searchParams.get('kind')).toBe('table')
    expect(url.searchParams.get('visibility')).toBe('visible')
  })

  it('enabled=false のときは問い合わせない', () => {
    renderHook(() => useFileSearch('space-1', { q: '請求' }, { enabled: false }), {
      wrapper: wrapper(makeClient()),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('全件取得とはキャッシュを分ける(検索しても全件のキャッシュを壊さない)', async () => {
    const client = makeClient()
    client.setQueryData(filesQueryKey('space-1'), { files: [{ id: 'cached' }], hasMore: true })
    fetchMock.mockResolvedValue(okFiles([{ id: 'searched' }]))

    const { result } = renderHook(
      () => useFileSearch('space-1', { q: '請求' }, { enabled: true }),
      { wrapper: wrapper(client) }
    )

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client.getQueryData(filesQueryKey('space-1')) as any).files[0].id).toBe('cached')
  })

  it('結果が多すぎるときは hasMore を返す(もっと絞ってもらうため)', async () => {
    fetchMock.mockResolvedValue(okFiles([], true))
    const { result } = renderHook(
      () => useFileSearch('space-1', { q: 'あ' }, { enabled: true }),
      { wrapper: wrapper(makeClient()) }
    )

    await waitFor(() => expect(result.current.hasMore).toBe(true))
  })
})

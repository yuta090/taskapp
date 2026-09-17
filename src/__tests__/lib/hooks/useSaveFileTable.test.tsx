import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSaveFileTable, FileTableConflictError } from '@/lib/hooks/useSaveFileTable'
import { fileTableQueryKey, type FileTableResult } from '@/lib/hooks/useFileTable'
import type { TableData } from '@/lib/table/parseDelimited'

/**
 * 直した表を、同じファイルへ書き戻す hook。
 * - 送るのは BOM 付き UTF-8 のバイト列(Excel で開いても化けない)
 * - 必ず「基準の版」を添える。ズレていたら 409 → 競合として止める(黙って上書きしない)
 */

const NEXT_UPDATED_AT = '2026-09-17T01:00:00.000Z'
const BASE_UPDATED_AT = '2026-09-17T00:00:00.000Z'

const fetchMock = vi.fn()
let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const table: TableData = { columns: ['会社名', '県'], rows: [['A社', '広島県']] }

function lastRequest(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url, init }
}

function sentBytes(): Uint8Array {
  return new Uint8Array(lastRequest().init.body as ArrayBuffer)
}

function sentText(): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(sentBytes())
}

function okResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

function errorResponse(status: number, body: Record<string, unknown> = {}) {
  return { ok: false, status, json: () => Promise.resolve(body) }
}

async function save(
  result: { current: ReturnType<typeof useSaveFileTable> },
  overrides: Partial<Parameters<ReturnType<typeof useSaveFileTable>['saveTable']>[0]> = {}
) {
  let outcome: unknown
  await act(async () => {
    outcome = await result.current
      .saveTable({
        fileId: 'f1',
        spaceId: 'space-1',
        table,
        delimiter: ',',
        baseUpdatedAt: BASE_UPDATED_AT,
        ...overrides,
      })
      .catch((err: unknown) => err)
  })
  return outcome
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('useSaveFileTable', () => {
  it('中身を PUT で送り、新しい版を返す', async () => {
    fetchMock.mockResolvedValue(okResponse({ updatedAt: NEXT_UPDATED_AT, sizeBytes: 42 }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    const outcome = await save(result)

    expect(lastRequest().url).toBe('/api/files/f1/content')
    expect(lastRequest().init.method).toBe('PUT')
    expect(outcome).toEqual({ updatedAt: NEXT_UPDATED_AT })
  })

  it('基準の版をヘッダに載せる(付け忘れるとサーバーが 400 で弾く)', async () => {
    fetchMock.mockResolvedValue(okResponse({ updatedAt: NEXT_UPDATED_AT }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    await save(result)

    const headers = lastRequest().init.headers as Record<string, string>
    expect(headers['X-Base-Updated-At']).toBe(BASE_UPDATED_AT)
  })

  it('Excel で開いても化けないよう、BOM 付き UTF-8 で送る', async () => {
    fetchMock.mockResolvedValue(okResponse({ updatedAt: NEXT_UPDATED_AT }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    await save(result)

    expect(Array.from(sentBytes().slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(sentText()).toContain('会社名,県\r\nA社,広島県')
  })

  it('元がタブ区切りなら、タブ区切りのまま書き戻す', async () => {
    fetchMock.mockResolvedValue(okResponse({ updatedAt: NEXT_UPDATED_AT }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    await save(result, { delimiter: '\t' })

    expect(sentText()).toContain('会社名\t県')
  })

  it('保存できたら、表のキャッシュを新しい中身と版で差し替える', async () => {
    queryClient.setQueryData<FileTableResult>(fileTableQueryKey('f1'), {
      table: { columns: ['会社名', '県'], rows: [['古い', '値']] },
      encoding: 'utf-8',
      updatedAt: BASE_UPDATED_AT,
      delimiter: ',',
    })
    fetchMock.mockResolvedValue(okResponse({ updatedAt: NEXT_UPDATED_AT }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    await save(result)

    const cached = queryClient.getQueryData<FileTableResult>(fileTableQueryKey('f1'))
    expect(cached?.table).toEqual(table)
    expect(cached?.updatedAt).toBe(NEXT_UPDATED_AT)
  })

  it('先に別の人が保存していたら、競合として止める', async () => {
    fetchMock.mockResolvedValue(errorResponse(409, { error: '別の場所で更新されています' }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    const outcome = await save(result)

    expect(outcome).toBeInstanceOf(FileTableConflictError)
  })

  it('直せない人(相手先)には、その理由が分かる失敗を返す', async () => {
    fetchMock.mockResolvedValue(errorResponse(403, { error: 'Access denied' }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    const outcome = await save(result)

    expect(outcome).toBeInstanceOf(Error)
    expect(outcome).not.toBeInstanceOf(FileTableConflictError)
    expect((outcome as Error).message).toContain('編集できる権限がありません')
  })

  it('書き込みに失敗して新しい版が返ってきたら、その版を添えて返す(同じ基準でやり直すと必ず競合するため)', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { error: 'Failed to write file', updatedAt: NEXT_UPDATED_AT }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    const outcome = await save(result)

    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error & { updatedAt?: string }).updatedAt).toBe(NEXT_UPDATED_AT)
  })

  it('大きすぎて保存できないときは、そのまま分かる言葉で返す', async () => {
    fetchMock.mockResolvedValue(errorResponse(413, { error: 'too large' }))
    const { result } = renderHook(() => useSaveFileTable(), { wrapper })

    const outcome = await save(result)

    expect((outcome as Error).message).toContain('大きすぎ')
  })
})

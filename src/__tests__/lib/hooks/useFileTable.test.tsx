import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFileTable, fileTableQueryKey } from '@/lib/hooks/useFileTable'

/**
 * ファイルの中身を取得 → 文字コード判定 → 表データに変換する hook。
 * API のエラー(413/415)は利用者向けの日本語メッセージに変換する。
 */

const fetchMock = vi.fn()

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function okBytes(text: string, encoding: 'utf-8' | 'shift_jis' = 'utf-8') {
  const bytes =
    encoding === 'utf-8'
      ? new TextEncoder().encode(text)
      : new Uint8Array([0x8d, 0x4c, 0x93, 0x87, 0x2c, 0x41, 0x0a, 0x31, 0x2c, 0x32]) // "広島,A\n1,2"
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useFileTable', () => {
  it('content API を叩いて表データにする', async () => {
    fetchMock.mockResolvedValue(okBytes('会社名,県\nA社,広島県\n'))
    const { result } = renderHook(() => useFileTable('f1'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(fetchMock).toHaveBeenCalledWith('/api/files/f1/content')
    expect(result.current.data?.table.columns).toEqual(['会社名', '県'])
    expect(result.current.data?.table.rows).toEqual([['A社', '広島県']])
    expect(result.current.data?.encoding).toBe('utf-8')
  })

  it('Shift_JIS のファイルも読める', async () => {
    fetchMock.mockResolvedValue(okBytes('', 'shift_jis'))
    const { result } = renderHook(() => useFileTable('f1'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.table.columns).toEqual(['広島', 'A'])
    expect(result.current.data?.encoding).toBe('shift_jis')
  })

  it('413 は「大きすぎる」、415 は「表として開けない」メッセージにする', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, json: () => Promise.resolve({ error: 'too large' }) })
    const big = renderHook(() => useFileTable('f1'), { wrapper })
    await waitFor(() => expect(big.result.current.error).toBeTruthy())
    expect(big.result.current.error?.message).toContain('大きすぎ')

    fetchMock.mockResolvedValue({ ok: false, status: 415, json: () => Promise.resolve({ error: 'not tabular' }) })
    const pdf = renderHook(() => useFileTable('f2'), { wrapper })
    await waitFor(() => expect(pdf.result.current.error).toBeTruthy())
    expect(pdf.result.current.error?.message).toContain('表として開けない')
  })

  it('fileId が無ければ取得しない', () => {
    renderHook(() => useFileTable(undefined), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queryKey は fileTable + fileId', () => {
    expect(fileTableQueryKey('f1')).toEqual(['fileTable', 'f1'])
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUpdateFile, type ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 保存ボタンを置かない方針なので、説明文・公開トグルは押した瞬間に一覧へ反映し、
 * 失敗したときだけ元に戻す(楽観更新)。
 */

const fetchMock = vi.fn()

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
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
    ...overrides,
  }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(['files', 'space-1'], [makeFile()])
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useUpdateFile(), { wrapper })
  return { client, result }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useUpdateFile の楽観更新', () => {
  it('説明文は通信の完了を待たずに一覧へ反映する', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

    const { client, result } = setup()

    act(() => {
      result.current.mutate({ spaceId: 'space-1', fileId: 'f1', description: '毎月の元データ' })
    })

    await waitFor(() => {
      const cached = client.getQueryData<ProjectFile[]>(['files', 'space-1'])
      expect(cached?.[0].description).toBe('毎月の元データ')
    })

    resolveFetch({ ok: true, json: () => Promise.resolve({ file: {} }) })
  })

  it('失敗したら元の値に戻す', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Access denied' }) })

    const { client, result } = setup()

    act(() => {
      result.current.mutate({ spaceId: 'space-1', fileId: 'f1', description: '毎月の元データ' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const cached = client.getQueryData<ProjectFile[]>(['files', 'space-1'])
    expect(cached?.[0].description).toBeNull()
  })

  it('公開トグルも同じように即反映する', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ file: {} }) })

    const { client, result } = setup()

    act(() => {
      result.current.mutate({ spaceId: 'space-1', fileId: 'f1', clientVisible: true })
    })

    await waitFor(() => {
      const cached = client.getQueryData<ProjectFile[]>(['files', 'space-1'])
      expect(cached?.[0].clientVisible).toBe(true)
    })
  })
})

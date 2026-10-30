import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiPages } from '@/lib/hooks/useWikiPages'

// 相手先に公開するとき、中に上げた画像も相手先に見えるようにする（社内のみのままだと
// ポータルで画像が出ない）。文中のリンク先のファイルには触らない（embeddedFiles.test.ts）

const IMG = '11111111-1111-1111-1111-111111111111'
const PAGE_BODY = JSON.stringify([{ type: 'image', props: { url: `/api/files/${IMG}/download` }, children: [] }])

const steps: string[] = []
let publicationError: unknown = null

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          order: () => Promise.resolve({ data: [], error: null }),
          single: () =>
            Promise.resolve(
              table === 'wiki_pages'
                ? { data: { id: 'page-1', title: '仕様', body: PAGE_BODY }, error: null }
                : { data: null, error: null }
            ),
        }
        return chain
      },
      insert: () => {
        steps.push(`insert:${table}`)
        return Promise.resolve({ error: publicationError })
      },
    }),
  }),
}))

const fetchMock = vi.fn()

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  steps.length = 0
  publicationError = null
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    steps.push(`fetch:${url}`)
    return new Response(JSON.stringify({ ok: true }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('useWikiPages.publishPage — 中の画像', () => {
  it('公開の前に、中の画像を相手先に見えるようにする', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org-1', spaceId: 'space-1' }), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.publishPage('page-1', 'ms-1')

    expect(fetchMock).toHaveBeenCalledWith(`/api/files/${IMG}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientVisible: true }),
    })
    expect(steps).toEqual([`fetch:/api/files/${IMG}`, 'insert:wiki_page_publications'])
  })

  it('画像を見えるようにできなければ、公開しない', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }))
    const { result } = renderHook(() => useWikiPages({ orgId: 'org-1', spaceId: 'space-1' }), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.publishPage('page-1', 'ms-1')).rejects.toThrow()
    expect(steps).not.toContain('insert:wiki_page_publications')
  })
})

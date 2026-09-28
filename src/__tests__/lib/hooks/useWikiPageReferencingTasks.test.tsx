import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiPageReferencingTasks } from '@/lib/hooks/useWikiPageReferencingTasks'
import { REFERENCING_TASKS_LIMIT } from '@/lib/wiki/referencingTasks'

// Wiki のページ情報に出す「このページを参照しているタスク」の取得。
// 1) 仕様書連携（tasks.wiki_page_id = ページ）と 2) 説明文に貼ったリンク（wiki?page=<id>）の
// 2本を並列に取り、重複をまとめる。どちらも同じスペースのタスクに限る。

type Call = { method: string; args: unknown[] }

/** 1本のクエリの呼び出しを記録する、連鎖できる偽物。limit で結果を返す */
function makeQuery(calls: Call[], resultFor: (calls: Call[]) => { data: unknown; error: unknown }) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'eq', 'ilike', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args })
    return Promise.resolve(resultFor(calls))
  }
  return builder
}

let queries: Call[][] = []
let linkedRows: unknown[] = []
let descriptionRows: unknown[] = []
let failWith: unknown = null

const mockFrom = vi.fn((table: string) => {
  if (table !== 'tasks') throw new Error(`unexpected table: ${table}`)
  const calls: Call[] = []
  queries.push(calls)
  return makeQuery(calls, (c) => {
    if (failWith) return { data: null, error: failWith }
    const isDescription = c.some((call) => call.method === 'ilike')
    return { data: isDescription ? descriptionRows : linkedRows, error: null }
  })
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function task(id: string, shortId: number) {
  return { id, org_id: 'org1', space_id: 'space1', short_id: shortId, title: id, status: 'todo', assignee_id: null }
}

const byMethod = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args)

describe('useWikiPageReferencingTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queries = []
    linkedRows = []
    descriptionRows = []
    failWith = null
  })

  it('仕様書連携と説明文のリンクの2本を、同じスペースに絞って取る', async () => {
    renderHook(() => useWikiPageReferencingTasks('org1', 'space1', 'page-1'), { wrapper })
    await waitFor(() => expect(queries).toHaveLength(2))

    for (const calls of queries) {
      expect(byMethod(calls, 'select')[0][0]).toBe('id, org_id, space_id, short_id, title, status, assignee_id')
      expect(byMethod(calls, 'eq')).toEqual(expect.arrayContaining([['org_id', 'org1'], ['space_id', 'space1']]))
      expect(byMethod(calls, 'limit')).toEqual([[REFERENCING_TASKS_LIMIT]])
    }
    const linked = queries.find((c) => byMethod(c, 'ilike').length === 0)!
    const described = queries.find((c) => byMethod(c, 'ilike').length > 0)!
    expect(byMethod(linked, 'eq')).toContainEqual(['wiki_page_id', 'page-1'])
    expect(byMethod(described, 'ilike')).toEqual([['description', '%wiki?page=page-1%']])
  })

  it('両方で見つかったタスクは1件にまとめる', async () => {
    linkedRows = [task('t1', 1)]
    descriptionRows = [task('t1', 1), task('t2', 2)]
    const { result } = renderHook(() => useWikiPageReferencingTasks('org1', 'space1', 'page-1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('ページが決まっていなければ取りに行かず、読み込み中にもしない', () => {
    const { result } = renderHook(() => useWikiPageReferencingTasks('org1', 'space1', null), { wrapper })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.tasks).toEqual([])
  })

  it('取得に失敗したら error を返し、一覧は空のまま', async () => {
    failWith = new Error('boom')
    const { result } = renderHook(() => useWikiPageReferencingTasks('org1', 'space1', 'page-1'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.tasks).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})

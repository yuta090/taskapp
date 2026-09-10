import { describe, it, expect, vi } from 'vitest'
import { fetchTasksQuery } from '@/lib/supabase/queries'

/**
 * fetchTasksQuery は `.limit(50)` で新しい50件しか取らない。/my（マイタスク）の
 * 詳細パネルは、一覧に出ているタスクが50件の外にあっても開けないといけないため、
 * ensureTaskIds を渡すと同じ Promise.all の中でそのタスクだけを別途取得し、
 * 50件の結果に（重複しないように）追加する。
 */

type TableChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
}

function makeTasksChain(
  limitResult: { data: unknown[]; error: unknown },
  inResult: { data: unknown[]; error: unknown }
): TableChain {
  const chain = {} as TableChain
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(limitResult))
  chain.in = vi.fn(() => Promise.resolve(inResult))
  return chain
}

function makeReviewsChain(result: { data: unknown[]; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => Promise.resolve(result))
  return chain
}

function makeSupabase(tasksChain: TableChain, reviewsResult: { data: unknown[]; error: unknown } = { data: [], error: null }) {
  const from = vi.fn((table: string) => {
    if (table === 'reviews') return makeReviewsChain(reviewsResult)
    if (table === 'tasks') return tasksChain
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
}

describe('fetchTasksQuery — ensureTaskIds（50件の外にあるタスクを補完取得する）', () => {
  it('50件の外にある ensureTaskIds のタスクを、担当者ごと結果へ追加する', async () => {
    const tasksChain = makeTasksChain(
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null },
      { data: [{ id: 'z', title: 'Z', task_owners: [{ id: 'o1', task_id: 'z', side: 'internal', user_id: 'u1' }] }], error: null }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1', { ensureTaskIds: ['z'] })

    expect(result.tasks.map((t) => t.id).sort()).toEqual(['a', 'z'])
    expect(result.owners['z']).toEqual([{ id: 'o1', task_id: 'z', side: 'internal', user_id: 'u1' }])
    // 同じ Promise.all の中で並列に取得している（.in が呼ばれている）こと
    expect(tasksChain.in).toHaveBeenCalledWith('id', ['z'])
  })

  it('50件の中に既にある id は重複させない', async () => {
    const tasksChain = makeTasksChain(
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null },
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1', { ensureTaskIds: ['a'] })

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('ensureTaskIds が無いときは補完クエリを発行しない', async () => {
    const tasksChain = makeTasksChain(
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null },
      { data: [{ id: 'z', title: 'Z', task_owners: [] }], error: null }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
    expect(tasksChain.in).not.toHaveBeenCalled()
  })

  it('補完クエリがエラーのときは、本体の結果を握りつぶさず reject する', async () => {
    // ensureTaskIds は「選択中タスクを確実に含める」という呼び出し元の要求そのもの。ここを
    // reviews のように警告だけで握りつぶすと、一時的な失敗で選択中タスクがキャッシュから
    // 静かに消え、開いている詳細パネルが「見つからない」表示に化けてしまう（D）。
    // react-query に失敗として扱わせ、前回の（選択中タスクを含んだ）データを保持させる。
    const tasksChain = makeTasksChain(
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null },
      { data: [], error: { message: 'boom' } }
    )
    const supabase = makeSupabase(tasksChain)

    await expect(
      fetchTasksQuery(supabase, 'org-1', 'space-1', { ensureTaskIds: ['z'] })
    ).rejects.toMatchObject({ message: 'boom' })
  })

  it('ensureTaskIds が無いときは、たとえ本体クエリ以外が失敗していても reject しない（補完クエリを発行していないため）', async () => {
    const tasksChain = makeTasksChain(
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null },
      { data: [], error: { message: 'boom' } }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
  })
})

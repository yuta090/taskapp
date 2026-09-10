import { describe, it, expect, vi } from 'vitest'
import { fetchTasksQuery, TASKS_PAGE_SIZE } from '@/lib/supabase/queries'

/**
 * fetchTasksQuery は空間(space)の全タスクを、TASKS_PAGE_SIZE件ずつ range ページングで
 * 全件読む（PostgRESTの1リクエストあたりの上限がデフォルト1000件のため、range指定なしでは
 * 大きいプロジェクトで黙って打ち切られる）。1ページ目は reviews / ensureTaskIds と同じ
 * Promise.all で並列取得し、1ページ目がちょうど TASKS_PAGE_SIZE 件だった場合のみ続きの
 * ページを順番に取得する。
 *
 * ensureTaskIds は「一覧の（読み込み済み）結果に入っていなくても、詳細表示のために
 * 必ず含めたいタスクID」を、同じ Promise.all の中で追加取得し重複なく足す機能。
 */

type TableChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  range: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
}

/**
 * tasks テーブル用のチェイン可能モック。
 * pageResults は `.range()` が呼ばれるたびに順番に返す結果（1回目=1ページ目、2回目=2ページ目…）。
 */
function makeTasksChain(
  pageResults: Array<{ data: unknown[]; error: unknown }>,
  inResult: { data: unknown[]; error: unknown } = { data: [], error: null }
): TableChain {
  const chain = {} as TableChain
  let pageCall = 0
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.range = vi.fn(() => {
    const result = pageResults[pageCall] ?? { data: [], error: null }
    pageCall += 1
    return Promise.resolve(result)
  })
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

function makeSupabase(
  tasksChain: TableChain,
  reviewsResult: { data: unknown[]; error: unknown } = { data: [], error: null }
) {
  const from = vi.fn((table: string) => {
    if (table === 'reviews') return makeReviewsChain(reviewsResult)
    if (table === 'tasks') return tasksChain
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
}

function makeTask(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: `task-${id}`, task_owners: [], ...overrides }
}

describe('fetchTasksQuery — 全件をページングで読む', () => {
  it('TASKS_PAGE_SIZE件未満なら、tasksリクエストは1回だけで全件返る（.limit(50)による打ち切りが無い）', async () => {
    const rows = Array.from({ length: 204 }, (_, i) => makeTask(String(i)))
    const tasksChain = makeTasksChain([{ data: rows, error: null }])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks).toHaveLength(204)
    expect(tasksChain.range).toHaveBeenCalledTimes(1)
    expect(tasksChain.range).toHaveBeenCalledWith(0, TASKS_PAGE_SIZE - 1)
  })

  it('1ページ目がちょうどTASKS_PAGE_SIZE件のときだけ2ページ目を取得し、重複なく結合する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeTask(`p1-${i}`))
    const page2 = [makeTask('p2-0'), makeTask('p2-1')]
    const tasksChain = makeTasksChain([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks).toHaveLength(TASKS_PAGE_SIZE + 2)
    const ids = result.tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length) // 重複なし
    expect(tasksChain.range).toHaveBeenCalledTimes(2)
    expect(tasksChain.range).toHaveBeenNthCalledWith(1, 0, TASKS_PAGE_SIZE - 1)
    expect(tasksChain.range).toHaveBeenNthCalledWith(2, TASKS_PAGE_SIZE, TASKS_PAGE_SIZE * 2 - 1)
  })

  it('created_at 降順・id 降順（タイブレーク）で並び替えている', async () => {
    const tasksChain = makeTasksChain([{ data: [makeTask('a')], error: null }])
    const supabase = makeSupabase(tasksChain)

    await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(tasksChain.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false })
    expect(tasksChain.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false })
  })

  it('2ページ目の取得がエラーなら reject する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeTask(`p1-${i}`))
    const tasksChain = makeTasksChain([
      { data: page1, error: null },
      { data: [], error: { message: 'page2 boom' } },
    ])
    const supabase = makeSupabase(tasksChain)

    await expect(fetchTasksQuery(supabase, 'org-1', 'space-1')).rejects.toMatchObject({
      message: 'page2 boom',
    })
  })

  it('ensureTaskIds は2ページ目まで読み込んだ全件に対して重複を除いて追加する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeTask(`p1-${i}`))
    const page2 = [makeTask('p2-0')]
    const tasksChain = makeTasksChain(
      [
        { data: page1, error: null },
        { data: page2, error: null },
      ],
      // ensureTaskIds で 'p2-0'（既に2ページ目に含まれる）と 'z'（未含有）を要求
      { data: [makeTask('p2-0'), makeTask('z')], error: null }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1', {
      ensureTaskIds: ['p2-0', 'z'],
    })

    expect(result.tasks).toHaveLength(TASKS_PAGE_SIZE + 2) // page1 + page2(1件) + z(1件)、p2-0は重複させない
    const ids = result.tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('z')
  })
})

describe('fetchTasksQuery — ensureTaskIds（一覧の読み込み範囲外のタスクを補完取得する）', () => {
  it('読み込み済みに無い ensureTaskIds のタスクを、担当者ごと結果へ追加する', async () => {
    const tasksChain = makeTasksChain(
      [{ data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }],
      { data: [{ id: 'z', title: 'Z', task_owners: [{ id: 'o1', task_id: 'z', side: 'internal', user_id: 'u1' }] }], error: null }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1', { ensureTaskIds: ['z'] })

    expect(result.tasks.map((t) => t.id).sort()).toEqual(['a', 'z'])
    expect(result.owners['z']).toEqual([{ id: 'o1', task_id: 'z', side: 'internal', user_id: 'u1' }])
    // 同じ Promise.all の中で並列に取得している（.in が呼ばれている）こと
    expect(tasksChain.in).toHaveBeenCalledWith('id', ['z'])
  })

  it('読み込み済みに既にある id は重複させない', async () => {
    const tasksChain = makeTasksChain(
      [{ data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }],
      { data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1', { ensureTaskIds: ['a'] })

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('ensureTaskIds が無いときは補完クエリを発行しない', async () => {
    const tasksChain = makeTasksChain(
      [{ data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }],
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
      [{ data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }],
      { data: [], error: { message: 'boom' } }
    )
    const supabase = makeSupabase(tasksChain)

    await expect(
      fetchTasksQuery(supabase, 'org-1', 'space-1', { ensureTaskIds: ['z'] })
    ).rejects.toMatchObject({ message: 'boom' })
  })

  it('ensureTaskIds が無いときは、たとえ本体クエリ以外が失敗していても reject しない（補完クエリを発行していないため）', async () => {
    const tasksChain = makeTasksChain(
      [{ data: [{ id: 'a', title: 'A', task_owners: [] }], error: null }],
      { data: [], error: { message: 'boom' } }
    )
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
  })
})

import { describe, it, expect, vi } from 'vitest'
import {
  fetchTasksQuery,
  fetchMeetingsQuery,
  MEETING_LIST_COLUMNS,
  TASKS_PAGE_SIZE,
} from '@/lib/supabase/queries'

/**
 * fetchTasksQuery は空間(space)の全タスクを、TASKS_PAGE_SIZE件ずつ range ページングで
 * 全件読む（PostgRESTの1リクエストあたりの上限がデフォルト1000件のため、range指定なしでは
 * 大きいプロジェクトで黙って打ち切られる）。1ページ目は reviews と同じ Promise.all で
 * 並列取得し、1ページ目がちょうど TASKS_PAGE_SIZE 件だった場合のみ続きのページを
 * 順番に取得する。
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
 * `.in()` は fetchTasksQuery からはもう発行されない（補完クエリ廃止）が、それを確かめる
 * ためだけにモックとして残す。
 */
function makeTasksChain(pageResults: Array<{ data: unknown[]; error: unknown }>): TableChain {
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
  chain.in = vi.fn(() => Promise.resolve({ data: [], error: null }))
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

  it('1ページ目がちょうどTASKS_PAGE_SIZE件のときだけ2ページ目を取得し、結合する', async () => {
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
    expect(tasksChain.range).toHaveBeenCalledTimes(2)
    expect(tasksChain.range).toHaveBeenNthCalledWith(1, 0, TASKS_PAGE_SIZE - 1)
    expect(tasksChain.range).toHaveBeenNthCalledWith(2, TASKS_PAGE_SIZE, TASKS_PAGE_SIZE * 2 - 1)
    expect(ids[0]).toBe('p1-0')
    expect(ids[ids.length - 1]).toBe('p2-1')
  })

  it('ページ境界をまたいで別の誰かがタスクを作成し行がずれても、跨ページの重複idを1件にまとめる', async () => {
    // offsetページングは「順位」で切るため、ページ取得の間に別の誰かが1件作成すると
    // 全行が1つずれ、1ページ目の最後の行が2ページ目の先頭にもう一度現れうる。
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeTask(`p1-${i}`))
    const overlappingId = page1[page1.length - 1].id // 'p1-999'
    const page2 = [makeTask(overlappingId), makeTask('p2-1')]
    const tasksChain = makeTasksChain([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    const ids = result.tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length) // 重複なし
    expect(ids.filter((id) => id === overlappingId)).toHaveLength(1)
    expect(result.tasks).toHaveLength(TASKS_PAGE_SIZE + 1) // page1(1000) + page2の新規1件のみ
  })

  it('3ページ目まで存在する場合、range(2000, 2999) まで順に取得し全件結合する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeTask(`p1-${i}`))
    const page2 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeTask(`p2-${i}`))
    const page3 = [makeTask('p3-0')]
    const tasksChain = makeTasksChain([
      { data: page1, error: null },
      { data: page2, error: null },
      { data: page3, error: null },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks).toHaveLength(TASKS_PAGE_SIZE * 2 + 1)
    expect(tasksChain.range).toHaveBeenCalledTimes(3)
    expect(tasksChain.range).toHaveBeenNthCalledWith(1, 0, TASKS_PAGE_SIZE - 1)
    expect(tasksChain.range).toHaveBeenNthCalledWith(2, TASKS_PAGE_SIZE, TASKS_PAGE_SIZE * 2 - 1)
    expect(tasksChain.range).toHaveBeenNthCalledWith(3, TASKS_PAGE_SIZE * 2, TASKS_PAGE_SIZE * 3 - 1)
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

  it('補完クエリ（.in(\'id\', …)）は発行しない（options 自体を廃止済み）', async () => {
    const tasksChain = makeTasksChain([{ data: [makeTask('a')], error: null }])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
    expect(tasksChain.in).not.toHaveBeenCalled()
  })
})

/**
 * fetchMeetingsQuery も tasks と同じ range ページング（共通ヘルパー）で全件読む。
 * 以前は `.limit(50)` で打ち切っていたため、週次ミーティングなどで空間の会議数が
 * 51件を超えると古い会議が一覧から静かに消えていた。
 */

type MeetingsChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  range: ReturnType<typeof vi.fn>
}

/**
 * meetings テーブル用のチェイン可能モック。
 * pageResults は `.range()` が呼ばれるたびに順番に返す結果（1回目=1ページ目、2回目=2ページ目…）。
 */
function makeMeetingsChain(pageResults: Array<{ data: unknown[]; error: unknown }>): MeetingsChain {
  const chain = {} as MeetingsChain
  let pageCall = 0
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.range = vi.fn(() => {
    const result = pageResults[pageCall] ?? { data: [], error: null }
    pageCall += 1
    return Promise.resolve(result)
  })
  return chain
}

function makeMeetingsSupabase(meetingsChain: MeetingsChain) {
  const from = vi.fn((table: string) => {
    if (table === 'meetings') return meetingsChain
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
}

function makeMeeting(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: `meeting-${id}`, meeting_participants: [], ...overrides }
}

describe('fetchMeetingsQuery — 全件をページングで読む', () => {
  it('50件を超えても、TASKS_PAGE_SIZE件未満なら1回のリクエストで全件返る（.limit(50)による打ち切りが無い）', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => makeMeeting(String(i)))
    const meetingsChain = makeMeetingsChain([{ data: rows, error: null }])
    const supabase = makeMeetingsSupabase(meetingsChain)

    const result = await fetchMeetingsQuery(supabase, 'space-1')

    expect(result.meetings).toHaveLength(120)
    expect(meetingsChain.range).toHaveBeenCalledTimes(1)
    expect(meetingsChain.range).toHaveBeenCalledWith(0, TASKS_PAGE_SIZE - 1)
  })

  it('1ページ目がちょうどTASKS_PAGE_SIZE件のときだけ2ページ目を取得し、境界の重複idを1件にまとめて結合する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeMeeting(`p1-${i}`))
    const overlappingId = page1[page1.length - 1].id // 'p1-999'
    const page2 = [makeMeeting(overlappingId), makeMeeting('p2-1')]
    const meetingsChain = makeMeetingsChain([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const supabase = makeMeetingsSupabase(meetingsChain)

    const result = await fetchMeetingsQuery(supabase, 'space-1')

    const ids = result.meetings.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length) // 重複なし
    expect(result.meetings).toHaveLength(TASKS_PAGE_SIZE + 1) // page1(1000) + page2の新規1件のみ
    expect(meetingsChain.range).toHaveBeenCalledTimes(2)
    expect(meetingsChain.range).toHaveBeenNthCalledWith(1, 0, TASKS_PAGE_SIZE - 1)
    expect(meetingsChain.range).toHaveBeenNthCalledWith(2, TASKS_PAGE_SIZE, TASKS_PAGE_SIZE * 2 - 1)
  })

  it('2ページ目の取得がエラーなら reject する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeMeeting(`p1-${i}`))
    const meetingsChain = makeMeetingsChain([
      { data: page1, error: null },
      { data: [], error: { message: 'page2 boom' } },
    ])
    const supabase = makeMeetingsSupabase(meetingsChain)

    await expect(fetchMeetingsQuery(supabase, 'space-1')).rejects.toMatchObject({
      message: 'page2 boom',
    })
  })

  it('held_at 降順・id 降順（タイブレーク）で並び替えている', async () => {
    const meetingsChain = makeMeetingsChain([{ data: [makeMeeting('a')], error: null }])
    const supabase = makeMeetingsSupabase(meetingsChain)

    await fetchMeetingsQuery(supabase, 'space-1')

    expect(meetingsChain.order).toHaveBeenNthCalledWith(1, 'held_at', { ascending: false })
    expect(meetingsChain.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false })
  })

  it('participants を meeting_participants から取り出し、id ごとに整理する', async () => {
    const meetingsChain = makeMeetingsChain([
      {
        data: [
          makeMeeting('a', {
            meeting_participants: [{ id: 'p1', meeting_id: 'a', side: 'client', user_id: 'u1' }],
          }),
        ],
        error: null,
      },
    ])
    const supabase = makeMeetingsSupabase(meetingsChain)

    const result = await fetchMeetingsQuery(supabase, 'space-1')

    expect(result.participants['a']).toEqual([
      { id: 'p1', meeting_id: 'a', side: 'client', user_id: 'u1' },
    ])
    expect((result.meetings[0] as unknown as { meeting_participants?: unknown }).meeting_participants).toBeUndefined()
  })
})

/**
 * notes / minutes_md はどの画面（一覧・行・詳細パネル・portal）でも使われておらず、
 * 一覧の全件ぶんが読み込まれブラウザの永続キャッシュ(IndexedDB)にも保存されるだけの
 * 無駄なので、一覧クエリでは読まない。
 */
describe('MEETING_LIST_COLUMNS — 使っていない列は読まない', () => {
  it('notes を含まない', () => {
    expect(MEETING_LIST_COLUMNS).not.toMatch(/\bnotes\b/)
  })

  it('minutes_md を含まない', () => {
    expect(MEETING_LIST_COLUMNS).not.toMatch(/\bminutes_md\b/)
  })
})

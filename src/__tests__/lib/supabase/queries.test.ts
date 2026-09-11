import { describe, it, expect, vi } from 'vitest'
import {
  fetchTasksQuery,
  fetchMeetingsQuery,
  collectRemainingPages,
  TASKS_PAGE_SIZE,
  MAX_COLLECT_PAGES,
} from '@/lib/supabase/queries'

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
 * collectRemainingPages は fetchTasksQuery/fetchMeetingsQuery 以外の呼び出し元
 * （例: ポータルの会議一覧 fetchPortalMeetingsData）からも使えるよう export されている。
 * ここではテーブル固有の形に依らない、ヘルパー単体としての振る舞いを確かめる。
 */
describe('collectRemainingPages（export された共通ヘルパー単体）', () => {
  it('1ページ目が pageSize 未満なら続きのページを取得しない', async () => {
    const fetchPage = vi.fn()
    const firstPage = [{ id: 'a' }, { id: 'b' }]

    const result = await collectRemainingPages(firstPage, fetchPage, 10)

    expect(result).toEqual(firstPage)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('1ページ目がちょうど pageSize 件なら続きを取得し、境界の重複idを1件にまとめる', async () => {
    const firstPage = [{ id: 'a' }, { id: 'b' }]
    // 1回目は pageSize と同数（=まだ続きがあるかもしれない）を返し、2回目（呼ばれなければ
    // 既定値）は pageSize 未満（=空）を返して読み切りを終える。fetchPage が常に pageSize
    // と同数を返し続ける固定モックにすると collectRemainingPages が無限ループし OOM する
    // ため、必ずページが尽きるキュー形式のモックにする。
    const pageResults = [{ data: [{ id: 'b' }, { id: 'c' }], error: null }]
    let callCount = 0
    const fetchPage = vi.fn(() => {
      const result = pageResults[callCount] ?? { data: [], error: null }
      callCount += 1
      return Promise.resolve(result)
    })

    const result = await collectRemainingPages(firstPage, fetchPage, 2)

    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(1, 2, 3)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 4, 5)
  })

  it('ページ取得がエラーを返すと reject する', async () => {
    const firstPage = [{ id: 'a' }, { id: 'b' }]
    const fetchPage = vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }))

    await expect(collectRemainingPages(firstPage, fetchPage, 2)).rejects.toMatchObject({
      message: 'boom',
    })
  })

  /**
   * 呼び出し元が .range() を付け忘れる等でDBが「常に満杯（pageSizeと同数）」を返し続ける
   * バグを踏むと、従来はページ取得が終わらず無限ループしてしまっていた（テスト実装中に
   * 実際にJSヒープを使い切ってクラッシュした）。呼び出し元が増えたため、ページ数に
   * 上限を設けて安全に停止できることを確かめる。
   *
   * このテスト自身のモックも「常に満杯」を返し続けるため、万一実装側の上限が効かない
   * 場合にテストプロセスがOOMしないよう、モック側にも呼び出し回数の安全弁を設けている。
   */
  it('DBが常に満杯を返し続けても、ページ数の上限に達するとエラーを投げて停止する', async () => {
    const pageSize = 10
    const firstPage = Array.from({ length: pageSize }, (_, i) => ({ id: `p0-${i}` }))
    // 固定の安全弁（MAX_COLLECT_PAGES を使わない）。実装が未修正/上限が壊れている場合でも
    // テストプロセスが長時間ハングしたりOOMしたりしないようにするための保険なので、
    // 実装側の値に依存させない（未実装で MAX_COLLECT_PAGES が undefined でも安全に動く）。
    const TEST_SAFETY_CAP = 200
    let callCount = 0
    const fetchPage = vi.fn(() => {
      callCount += 1
      if (callCount > TEST_SAFETY_CAP) {
        throw new Error(
          `test safety cap (${TEST_SAFETY_CAP}) exceeded — collectRemainingPages did not stop`
        )
      }
      return Promise.resolve({
        data: Array.from({ length: pageSize }, (_, i) => ({ id: `p${callCount}-${i}` })),
        error: null,
      })
    })

    await expect(collectRemainingPages(firstPage, fetchPage, pageSize)).rejects.toThrow(
      new RegExp(String(MAX_COLLECT_PAGES))
    )
    // 上限ページ数までしか呼ばれず、そこで止まっていること
    expect(fetchPage).toHaveBeenCalledTimes(MAX_COLLECT_PAGES - 1)
  })
})

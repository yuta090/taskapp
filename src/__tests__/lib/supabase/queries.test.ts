import { describe, it, expect, vi } from 'vitest'
import {
  fetchTasksQuery,
  fetchMeetingsQuery,
  fetchSpaceRowQuery,
  collectRemainingPages,
  MEETING_LIST_COLUMNS,
  MEETING_DETAIL_COLUMNS,
  TASKS_PAGE_SIZE,
  MAX_COLLECT_PAGES,
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

  it('1ページ目・2ページ目それぞれの task_owners を owners へ id ごとに取り出し、tasks側には残さない', async () => {
    // ensureTaskIds 撤去後、担当者を揃えるのはこの取り出し処理だけになった。ここが壊れると
    // ボールを渡すときに担当者が空のまま rpc_pass_ball に渡り、担当者が消えてしまう。
    const owner1 = { id: 'o1', task_id: 'p1-0', side: 'internal', user_id: 'u1' }
    const owner2 = { id: 'o2', task_id: 'p2-0', side: 'client', user_id: 'u2' }
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) =>
      i === 0 ? makeTask('p1-0', { task_owners: [owner1] }) : makeTask(`p1-${i}`)
    )
    const page2 = [makeTask('p2-0', { task_owners: [owner2] })]
    const tasksChain = makeTasksChain([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.owners['p1-0']).toEqual([owner1])
    expect(result.owners['p2-0']).toEqual([owner2])
    result.tasks.forEach((t) => {
      expect((t as unknown as { task_owners?: unknown }).task_owners).toBeUndefined()
    })
    // task_owners を同じクエリで一緒に読んでいること（実装どおりの列指定）
    expect(tasksChain.select).toHaveBeenCalledWith(
      '*, task_owners (*), task_internal_metrics (actual_hours)'
    )
  })

  it('補完クエリ（.in(\'id\', …)）は発行しない（options 自体を廃止済み）', async () => {
    const tasksChain = makeTasksChain([{ data: [makeTask('a')], error: null }])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks.map((t) => t.id)).toEqual(['a'])
    expect(tasksChain.in).not.toHaveBeenCalled()
  })

  /**
   * 実績工数(actual_hours)は C2 で社内専用の別表 task_internal_metrics（task_id 1:1）
   * に移した。tasks.* の生の列（つなぎトリガーが写す旧列。C3 で削除予定）ではなく、
   * 埋め込みで読んだ新表の値を task.actual_hours として使う（呼び出し側の形は変えない）。
   */
  it('task_internal_metrics の埋め込み(object)から actual_hours を取り出し、tasks側には残さない', async () => {
    const tasksChain = makeTasksChain([
      {
        data: [makeTask('a', { actual_hours: 999, task_internal_metrics: { actual_hours: 12.5 } })],
        error: null,
      },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks[0].actual_hours).toBe(12.5)
    expect(
      (result.tasks[0] as unknown as { task_internal_metrics?: unknown }).task_internal_metrics
    ).toBeUndefined()
  })

  it('埋め込みが配列で返っても(to-one embed)先頭要素から actual_hours を取り出す', async () => {
    const tasksChain = makeTasksChain([
      { data: [makeTask('a', { task_internal_metrics: [{ actual_hours: 3 }] })], error: null },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks[0].actual_hours).toBe(3)
  })

  it('task_internal_metrics に行が無い(null)場合は actual_hours も null になる', async () => {
    const tasksChain = makeTasksChain([
      { data: [makeTask('a', { actual_hours: 999, task_internal_metrics: null })], error: null },
    ])
    const supabase = makeSupabase(tasksChain)

    const result = await fetchTasksQuery(supabase, 'org-1', 'space-1')

    expect(result.tasks[0].actual_hours).toBeNull()
  })
})

describe('fetchSpaceRowQuery — 代理店設定(default_margin_rate/vendor_settings)は space_agency_settings から読む', () => {
  function makeSpaceChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(() => Promise.resolve(result))
    return chain
  }

  function makeSpaceSupabase(chain: ReturnType<typeof makeSpaceChain>) {
    const from = vi.fn((table: string) => {
      if (table === 'spaces') return chain
      throw new Error(`unexpected table: ${table}`)
    })
    return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
  }

  it('埋め込みの値を default_margin_rate / vendor_settings として平らにする', async () => {
    const chain = makeSpaceChain({
      data: {
        id: 'space-1',
        name: 'テスト',
        default_margin_rate: 999, // 旧列(つなぎ)の値。埋め込みの値を優先する
        vendor_settings: { show_client_name: true, allow_client_comments: true }, // 旧列
        space_agency_settings: {
          default_margin_rate: 35,
          vendor_settings: { show_client_name: false, allow_client_comments: true },
        },
      },
      error: null,
    })
    const supabase = makeSpaceSupabase(chain)

    const result = await fetchSpaceRowQuery(supabase, 'space-1')

    expect(result?.default_margin_rate).toBe(35)
    expect(result?.vendor_settings).toEqual({ show_client_name: false, allow_client_comments: true })
    expect((result as Record<string, unknown>).space_agency_settings).toBeUndefined()
  })

  it('space_agency_settings に行が無い space では既定値（マージン無し・ベンダー設定は両方false）で補う', async () => {
    const chain = makeSpaceChain({
      data: {
        id: 'space-1',
        name: 'テスト',
        // 新表に行が無くても、旧列(つなぎ)に値が残っていることがある(C3で削除予定)。
        // 埋め込みが null なら既定値を出す(旧列の値を画面に出さない)
        default_margin_rate: 999,
        vendor_settings: { show_client_name: true, allow_client_comments: true },
        space_agency_settings: null,
      },
      error: null,
    })
    const supabase = makeSpaceSupabase(chain)

    const result = await fetchSpaceRowQuery(supabase, 'space-1')

    expect(result?.default_margin_rate).toBeNull()
    expect(result?.vendor_settings).toEqual({ show_client_name: false, allow_client_comments: false })
  })

  it('space の行自体が無ければ null を返す', async () => {
    const chain = makeSpaceChain({ data: null, error: null })
    const supabase = makeSpaceSupabase(chain)

    const result = await fetchSpaceRowQuery(supabase, 'space-1')

    expect(result).toBeNull()
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

/**
 * notes はどの画面でも読んでおらず、一覧の全件ぶんが読み込まれブラウザの永続キャッシュ
 * (IndexedDB)にも保存されるだけの無駄なので、一覧クエリでは読まない。
 *
 * minutes_md（議事録本文）は詳細パネル専用。一覧には含めず、開いたときに
 * useMeetings.fetchMeetingDetail が `MEETING_DETAIL_COLUMNS` でオンデマンド取得する。
 * 一覧の行が `minutes_md === undefined` のままであること自体が「詳細をまだ取っていない」
 * の目印(MeetingsPageClient)として使われているため、null 等に揃えず、そのまま
 * 列自体を返さないでおく必要がある。
 */
describe('MEETING_LIST_COLUMNS — 使っていない列は読まない・議事録本文は一覧に含めない', () => {
  it('notes を含まない', () => {
    expect(MEETING_LIST_COLUMNS).not.toMatch(/\bnotes\b/)
  })

  it('minutes_md を含まない（詳細パネルの fetchMeetingDetail が別途取得するため）', () => {
    expect(MEETING_LIST_COLUMNS).not.toMatch(/\bminutes_md\b/)
  })
})

describe('MEETING_DETAIL_COLUMNS — notes を含まず、一覧と同じ基本列 + minutes_md を持つ', () => {
  it('notes を含まない', () => {
    expect(MEETING_DETAIL_COLUMNS).not.toMatch(/\bnotes\b/)
  })

  it('minutes_md を含む（議事録本文のオンデマンド取得のため）', () => {
    expect(MEETING_DETAIL_COLUMNS).toMatch(/\bminutes_md\b/)
  })

  it('一覧で使っている基本列（meeting_participants の埋め込みを除く）をすべて含む', () => {
    const listBaseColumns = MEETING_LIST_COLUMNS
      .replace(/meeting_participants\s*\(\*\)/, '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)

    for (const column of listBaseColumns) {
      expect(MEETING_DETAIL_COLUMNS).toMatch(new RegExp(`\\b${column}\\b`))
    }
  })
})

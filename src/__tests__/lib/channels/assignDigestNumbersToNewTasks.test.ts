import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * assignDigestNumbersToNewTasks（練習・その場の登録で使う採番）。
 *
 * 一覧の番号を全部振り直してよいのは**配信の直前（毎朝の cron）だけ**という不変条件を守るための関数。
 * チャットの発言をきっかけに走るこちらは、**番号がまだ無いタスクにだけ**続きの番号を与える。
 *
 * ここが壊れると、利用者が手元で見ている一覧の番号と実物がズレて、
 * 「完了3」で別のタスクが消えるという最悪の事故になる。
 */

type Row = {
  id: string
  title: string
  status: string
  digest_number: number | null
  created_at: string
  due_date: string | null
  due_time: string | null
  assignee_hint: string | null
}

function row(over: Partial<Row> & { id: string }): Row {
  return {
    title: `タスク ${over.id}`,
    status: 'open',
    digest_number: null,
    created_at: '2026-07-30T00:00:00.000Z',
    due_date: null,
    due_time: null,
    assignee_hint: null,
    ...over,
  }
}

/** そのグループにDB上ある全行（このテストの「DBの中身」）。 */
let selectResponse: { data: Row[] | null; error: { message: string } | null }
let updateError: { message: string } | null
/** update({digest_number}) が飛んだ先を記録する（どの行の番号を書き換えたか） */
let updates: Array<{ id: string; digestNumber: number | null }>
/** 読み取りに掛けた絞り込み（eq）を記録する。「open だけ読んでいるか」を見るため */
let filters: Array<{ column: string; value: string }>
/** 読み取りに掛けた件数上限（limit）を記録する */
let limits: number[]

const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

/**
 * supabase-js のクエリビルダの最小の偽物。
 * DBの中身（selectResponse.data）に対して、実際に掛けた絞り込み・並び・上限を適用して返す
 * ＝「絞り込みを掛けたつもり」で通ってしまわないようにする。
 */
function makeBuilder() {
  let pendingUpdate: number | null = null
  let isUpdate = false
  let selectedColumns = ''
  let orderColumn = 'created_at'
  let orderAscending = true
  let notNullColumn: string | null = null
  let limitValue: number | null = null
  const eqFilters: Array<{ column: string; value: string }> = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn((columns: string) => {
      selectedColumns = columns
      return builder
    }),
    order: vi.fn((column: string, opts?: { ascending?: boolean }) => {
      orderColumn = column
      orderAscending = opts?.ascending !== false
      return builder
    }),
    not: vi.fn((column: string) => {
      notNullColumn = column
      return builder
    }),
    limit: vi.fn((n: number) => {
      limitValue = n
      limits.push(n)
      return builder
    }),
    in: vi.fn(() => builder),
    update: vi.fn((patch: { digest_number: number | null }) => {
      isUpdate = true
      pendingUpdate = patch.digest_number
      return builder
    }),
    eq: vi.fn((column: string, value: string) => {
      if (isUpdate && column === 'id') updates.push({ id: value, digestNumber: pendingUpdate })
      if (!isUpdate) {
        eqFilters.push({ column, value })
        filters.push({ column, value })
      }
      return builder
    }),
  }

  function resolveSelect() {
    if (selectResponse.error || !selectResponse.data) return selectResponse
    let rows = selectResponse.data
    for (const f of eqFilters) {
      if (f.column === 'group_id') continue
      rows = rows.filter((r) => String((r as unknown as Record<string, unknown>)[f.column]) === f.value)
    }
    if (notNullColumn) {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[notNullColumn!] !== null)
    }
    rows = [...rows].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[orderColumn] as string | number
      const bv = (b as unknown as Record<string, unknown>)[orderColumn] as string | number
      const diff = av < bv ? -1 : av > bv ? 1 : 0
      return orderAscending ? diff : -diff
    })
    if (limitValue !== null) rows = rows.slice(0, limitValue)
    // 列を絞ったクエリはその列だけ返す（本物の挙動にそろえる）
    if (selectedColumns === 'digest_number') {
      return { data: rows.map((r) => ({ digest_number: r.digest_number })), error: null }
    }
    return { data: rows, error: null }
  }

  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(isUpdate ? { data: null, error: updateError } : resolveSelect()).then(resolve)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  selectResponse = { data: [], error: null }
  updateError = null
  updates = []
  filters = []
  limits = []
  fromMock.mockImplementation(() => makeBuilder())
})

describe('assignDigestNumbersToNewTasks', () => {
  it('番号がまだ無いタスクにだけ、続きの番号を与える（既存の番号は1つも動かさない）', async () => {
    selectResponse = {
      data: [
        row({ id: 'a', digest_number: 1, created_at: '2026-07-30T01:00:00.000Z' }),
        row({ id: 'b', digest_number: 2, created_at: '2026-07-30T02:00:00.000Z' }),
        row({ id: 'c', digest_number: null, created_at: '2026-07-30T03:00:00.000Z' }),
      ],
      error: null,
    }

    const result = await store.assignDigestNumbersToNewTasks('group-1')

    // 書き換えたのは新しい1件だけ。既存の a・b には update を飛ばさない
    expect(updates).toEqual([{ id: 'c', digestNumber: 3 }])
    expect(result.map((t) => [t.id, t.digestNumber])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('番号の総入れ替え（全行NULLクリア）は絶対にしない', async () => {
    selectResponse = {
      data: [row({ id: 'a', digest_number: 5 }), row({ id: 'b', digest_number: null })],
      error: null,
    }

    await store.assignDigestNumbersToNewTasks('group-1')

    expect(updates.some((u) => u.digestNumber === null)).toBe(false)
  })

  it('完了済みのタスクが持っている番号も避ける（同じ番号を二重に配らない）', async () => {
    selectResponse = {
      data: [
        row({ id: 'done', status: 'done', digest_number: 7 }),
        row({ id: 'new', digest_number: null }),
      ],
      error: null,
    }

    const result = await store.assignDigestNumbersToNewTasks('group-1')

    expect(updates).toEqual([{ id: 'new', digestNumber: 8 }])
    // 返すのは一覧に出る（open な）タスクだけ
    expect(result.map((t) => t.id)).toEqual(['new'])
  })

  it('新しいタスクが複数あれば、古い順に続きの番号を与える', async () => {
    selectResponse = {
      data: [
        row({ id: 'x', digest_number: null, created_at: '2026-07-30T01:00:00.000Z' }),
        row({ id: 'y', digest_number: null, created_at: '2026-07-30T02:00:00.000Z' }),
      ],
      error: null,
    }

    const result = await store.assignDigestNumbersToNewTasks('group-1')

    expect(updates).toEqual([
      { id: 'x', digestNumber: 1 },
      { id: 'y', digestNumber: 2 },
    ])
    expect(result.map((t) => t.digestNumber)).toEqual([1, 2])
  })

  it('全部に番号が付いていれば1件も書き換えない', async () => {
    selectResponse = {
      data: [row({ id: 'a', digest_number: 1 }), row({ id: 'b', digest_number: 2 })],
      error: null,
    }

    await store.assignDigestNumbersToNewTasks('group-1')

    expect(updates).toEqual([])
  })

  it('読み取りに失敗したら例外にする（番号が分からないまま約束しない）', async () => {
    selectResponse = { data: null, error: { message: 'boom' } }
    await expect(store.assignDigestNumbersToNewTasks('group-1')).rejects.toThrow('boom')
  })

  it('番号の書き込みに失敗したら例外にする', async () => {
    selectResponse = { data: [row({ id: 'a' })], error: null }
    updateError = { message: 'update boom' }
    await expect(store.assignDigestNumbersToNewTasks('group-1')).rejects.toThrow('update boom')
  })
})

/**
 * 読む行を必ず絞る（実害）。
 *
 * この関数は「一覧」コマンドで**人が何度でも叩ける**経路になった。
 * 絞り込みも上限も無いままだと、長く使っているグループでは完了済みの行が延々と積み上がり、
 * 1回の「一覧」で全部読むことになる（重くなる・詰まる）。
 * 一覧に出すのは open のタスクだけなので、読むのも open に絞り、件数にも上限を置く。
 */
describe('assignDigestNumbersToNewTasks — 読む行を絞る', () => {
  it('一覧に出す行は open だけを読む（完了済みの山を毎回読まない）', async () => {
    selectResponse = { data: [row({ id: 'a' })], error: null }
    await store.assignDigestNumbersToNewTasks('group-1')

    expect(filters).toContainEqual({ column: 'status', value: 'open' })
  })

  it('読む件数に上限を置く（際限なく読まない）', async () => {
    selectResponse = { data: [row({ id: 'a' })], error: null }
    await store.assignDigestNumbersToNewTasks('group-1')

    expect(limits.length).toBeGreaterThan(0)
    expect(Math.max(...limits)).toBeLessThanOrEqual(store.ASSIGN_DIGEST_NUMBERS_MAX_ROWS)
  })
})

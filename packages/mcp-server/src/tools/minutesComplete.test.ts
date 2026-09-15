import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 議事録でチェックが付いている行のタスクを、まとめて完了にする道具。
 *
 * 画面ではチェックを入れた瞬間に完了になるが、それはブラウザの中の処理で、CLI から
 * 本文を `- [x]` に書き換えても何も起きなかった。会議のあとに CLI で議事録を整える
 * 使い方だと、完了にし忘れたタスクが残る。
 */

const T1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const T2 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const SPACE = '00000000-0000-0000-0000-000000000010'
const MEETING = '00000000-0000-0000-0000-000000000099'

let minutesMd = ''
let taskRows: Array<Record<string, unknown>> = []
/** update のたびに記録する。id → 返すエラー（null なら成功） */
let updateErrors: Record<string, { code?: string; message?: string } | null> = {}
const updates: Array<{ id: string; payload: Record<string, unknown> }> = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  let updatePayload: Record<string, unknown> | null = null
  let eqId: string | null = null
  c.select = () => c
  c.in = () => c
  c.eq = (col: string, value: string) => {
    if (col === 'id') eqId = value
    return c
  }
  c.update = (payload: Record<string, unknown>) => {
    updatePayload = payload
    return {
      eq: (col: string, value: string) => {
        if (col === 'id') eqId = value
        return {
          eq: () => ({
            eq: async () => {
              updates.push({ id: eqId as string, payload: updatePayload as Record<string, unknown> })
              return { error: updateErrors[eqId as string] ?? null }
            },
          }),
        }
      },
    }
  }
  c.single = async () =>
    table === 'spaces'
      ? { data: { org_id: 'org-1' }, error: null }
      : { data: { id: MEETING, minutes_md: minutesMd }, error: null }
  // tasks の一覧は then で解決する（select().in().eq().eq() のあと await）
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: taskRows, error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { minutesCompleteChecked } = await import('./minutesComplete.js')

const line = (checked: boolean, text: string, id: string) =>
  `- [${checked ? 'x' : ' '}] ${text} <!--task:${id}-->`

beforeEach(() => {
  minutesMd = ''
  taskRows = []
  updateErrors = {}
  updates.length = 0
})

describe('minutes_complete_checked', () => {
  it('チェックが付いている行のタスクを完了にする', async () => {
    minutesMd = [line(true, '玄関の向きを決める', T1), line(false, 'まだのやつ', T2)].join('\n')
    taskRows = [{ id: T1, title: '玄関の向きを決める', status: 'todo', type: 'task', decision_state: null }]

    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })

    expect(result.completedCount).toBe(1)
    expect(result.items[0]).toMatchObject({ taskId: T1, result: 'completed' })
    expect(updates).toHaveLength(1)
    expect(updates[0].payload.status).toBe('done')
  })

  it('チェックの付いていない行は触らない', async () => {
    minutesMd = line(false, 'まだのやつ', T1)
    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })
    expect(result.checkedCount).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('すでに完了のタスクは触らない（何度実行しても同じ）', async () => {
    minutesMd = line(true, '終わってる', T1)
    taskRows = [{ id: T1, title: '終わってる', status: 'done', type: 'task', decision_state: null }]

    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })

    expect(result.completedCount).toBe(0)
    expect(result.items[0]).toMatchObject({ result: 'already_done' })
    expect(updates).toHaveLength(0)
  })

  it('決まっていない決定事項のタスクは、理由を添えて断る（勝手に決定にしない）', async () => {
    minutesMd = line(true, '間取りを決める', T1)
    taskRows = [{ id: T1, title: '間取りを決める', status: 'todo', type: 'spec', decision_state: 'considering' }]
    updateErrors[T1] = { code: '23514', message: 'Cannot complete task: spec decision is not made' }

    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })

    expect(result.completedCount).toBe(0)
    expect(result.items[0].result).toBe('blocked')
    expect(result.items[0].reason).toContain('決定事項がまだ決まっていない')
    // 決定にはしない
    expect(updates.every((u) => u.payload.decision_state === undefined)).toBe(true)
  })

  it('承認が終わっていないときも、理由を添えて断る', async () => {
    minutesMd = line(true, 'レビュー待ち', T1)
    taskRows = [{ id: T1, title: 'レビュー待ち', status: 'todo', type: 'task', decision_state: null }]
    updateErrors[T1] = { code: '23514', message: 'Cannot complete task: review is not approved' }

    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })
    expect(result.items[0].reason).toContain('レビューの承認')
  })

  it('DB の細かい理由はそのまま返さない', async () => {
    minutesMd = line(true, 'なにか', T1)
    taskRows = [{ id: T1, title: 'なにか', status: 'todo', type: 'task', decision_state: null }]
    updateErrors[T1] = { code: '42501', message: 'permission denied for table tasks' }

    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })
    expect(result.items[0].reason).toBe('完了にできませんでした')
    expect(JSON.stringify(result)).not.toContain('permission denied')
  })

  it('下見（dryRun）では何も書き換えない', async () => {
    minutesMd = [line(true, 'ふつう', T1), line(true, '未決', T2)].join('\n')
    taskRows = [
      { id: T1, title: 'ふつう', status: 'todo', type: 'task', decision_state: null },
      { id: T2, title: '未決', status: 'todo', type: 'spec', decision_state: 'considering' },
    ]

    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING, dryRun: true })

    expect(updates).toHaveLength(0)
    expect(result.dryRun).toBe(true)
    expect(result.items.find((i) => i.taskId === T1)?.result).toBe('completed')
    expect(result.items.find((i) => i.taskId === T2)?.result).toBe('blocked')
  })

  it('本文に印があっても、このプロジェクトに無いタスクは触らない', async () => {
    minutesMd = line(true, 'よそのタスク', T1)
    taskRows = [] // space で絞った結果、見つからない
    const result = await minutesCompleteChecked({ spaceId: SPACE, meetingId: MEETING })
    expect(result.checkedCount).toBe(1)
    expect(result.items).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })
})

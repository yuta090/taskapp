import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * updateDigestTaskStatusConsole の空遷移no-op化（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-1 付随修正）。
 *
 * 同一statusへの更新は実UPDATEを発行しない: done→doneの再送(楽観的更新のリトライ・
 * 二重クリック等)でdone_at/done_via/done_by_external_user_idが新しい値で上書きされ、
 * 元の消し込み証跡が壊れるのを防ぐ。トリガー(old.status IS DISTINCT FROM new.status)は
 * 元々空遷移では発火しないため、sink配達への影響はない。
 *
 * ただしAPI層は「task not found」と「既に同じstatus」を区別できる必要がある
 * （二重クリックを404エラー扱いにしない=冪等成功として返す）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'update']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let updateResponse: { data: unknown; error: unknown }
let existsResponse: { data: unknown; error: unknown }
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { updateDigestTaskStatusConsole } = await import('@/lib/channels/store')

const TASK_ID = 'task-1'

beforeEach(() => {
  vi.clearAllMocks()
  updateResponse = { data: { id: TASK_ID }, error: null }
  existsResponse = { data: { id: TASK_ID }, error: null }

  let call = 0
  fromMock.mockImplementation(() => {
    call += 1
    // 1回目の呼び出し = update chain、2回目(no-op判定時のみ) = existence check chain
    return call === 1 ? chain(updateResponse) : chain(existsResponse)
  })
})

describe('updateDigestTaskStatusConsole', () => {
  it('performs the update and scopes it to rows NOT already at the target status', async () => {
    const result = await updateDigestTaskStatusConsole(TASK_ID, 'done')
    expect(result).toBe(true)

    const updateBuilder = fromMock.mock.results[0].value
    expect(updateBuilder.neq).toHaveBeenCalledWith('status', 'done')
  })

  it('is idempotent (returns true, no error) when the task is already at the target status', async () => {
    updateResponse = { data: null, error: null } // neq('status','done')に0件マッチ = 既にdone
    existsResponse = { data: { id: TASK_ID }, error: null } // でもtaskId自体は実在する

    const result = await updateDigestTaskStatusConsole(TASK_ID, 'done')
    expect(result).toBe(true)
  })

  it('returns false when the task does not exist at all', async () => {
    updateResponse = { data: null, error: null }
    existsResponse = { data: null, error: null }

    const result = await updateDigestTaskStatusConsole(TASK_ID, 'done')
    expect(result).toBe(false)
  })

  it('returns false on a DB error without falling through to the existence check', async () => {
    updateResponse = { data: null, error: { message: 'boom' } }
    const result = await updateDigestTaskStatusConsole(TASK_ID, 'done')
    expect(result).toBe(false)
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('open recovery also guards against a same-status no-op', async () => {
    const result = await updateDigestTaskStatusConsole(TASK_ID, 'open')
    expect(result).toBe(true)
    const updateBuilder = fromMock.mock.results[0].value
    expect(updateBuilder.neq).toHaveBeenCalledWith('status', 'open')
  })
})

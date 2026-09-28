import { describe, it, expect, vi } from 'vitest'

/**
 * minutes_get / minutes_update / minutes_append / minutes_toc の getOrgId・会議取得・
 * 書き込みは、DBが断った理由を全部「見つかりません」等の一般Errorに潰し、cause も残さな
 * かった。0件（PGRST116）は ToolUserError(404)、それ以外は一般Errorのままだが、どちらも
 * 元のDBエラーを cause に残す。
 *
 * getMeetingScoped は `.single()` を使い、minutes_update/minutes_toc の書き込みは
 * `.select('*')`（配列で返る、.single() ではない）を使うため、モックはメソッドで
 * 振る舞いを分ける。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEETING = '00000000-0000-0000-0000-000000000030'
const ORG = 'org-1'
const MEETING_ROW = { id: MEETING, title: 't', status: 'planned', minutes_md: 'x', updated_at: 'now' }

type TableConfig = {
  singleError?: { code?: string; message: string }
  /** 何回目以降の .single() 呼び出しから失敗させるか（1始まり）。省略時は毎回 singleError を返す */
  singleErrorFrom?: number
  writeError?: { code?: string; message: string }
}
let tableConfig: Record<string, TableConfig> = {}
const singleCallCounts: Record<string, number> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update']) c[m] = () => c
  c.single = async () => {
    singleCallCounts[table] = (singleCallCounts[table] ?? 0) + 1
    const shouldFail = cfg?.singleError && (cfg.singleErrorFrom === undefined || singleCallCounts[table] >= cfg.singleErrorFrom)
    if (shouldFail) return { data: null, error: cfg!.singleError }
    if (table === 'meetings') return { data: MEETING_ROW, error: null }
    return { data: { org_id: ORG }, error: null }
  }
  // minutes_update/minutes_toc の書き込みは `.select('*')` のみ（.single() ではない）で
  // 解決される thenable
  c.then = (resolve: (v: unknown) => void) =>
    resolve(cfg?.writeError ? { data: null, error: cfg.writeError } : { data: [MEETING_ROW], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: { message: 'rpc unavailable' } }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { minutesGet, minutesUpdate, minutesAppend, minutesToc } = await import('./minutes.js')

function resetTableConfig() {
  tableConfig = {}
  for (const k of Object.keys(singleCallCounts)) delete singleCallCounts[k]
}

describe('minutes_get — getOrgId・会議取得', () => {
  it('spacesが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { singleError: { code: 'PGRST116', message: 'no rows' } }

    const err = (await minutesGet({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.singleError)
  })

  it('meetingsの見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.meetings = { singleError: { code: '42501', message: 'permission denied for table meetings' } }

    const err = (await minutesGet({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.singleError)
  })
})

describe('minutes_update / minutes_append / minutes_toc — 書き込みの失敗', () => {
  it('minutes_update: 更新に失敗しても、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.meetings = { writeError: { code: '42501', message: 'permission denied for table meetings' } }

    const err = (await minutesUpdate({ spaceId: SPACE, meetingId: MEETING, minutesMd: 'x' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.writeError)
  })

  it('minutes_append: RPCが無ければ読み直し書き込みに落ち、失敗はcauseにDBエラーを残す', async () => {
    resetTableConfig()
    // 1回目の .single()（getMeetingScoped の確認）は通し、2回目（最終書き込み）だけ失敗させる
    tableConfig.meetings = { singleError: { code: '42501', message: 'permission denied for table meetings' }, singleErrorFrom: 2 }

    const err = (await minutesAppend({ spaceId: SPACE, meetingId: MEETING, content: 'c' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.singleError)
  })

  it('minutes_toc: 更新に失敗しても、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.meetings = { writeError: { code: '42501', message: 'permission denied for table meetings' } }

    const err = (await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'add' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.writeError)
  })
})

import { describe, it, expect, vi } from 'vitest'

/**
 * ball_pass / ball_query も task_get / task_list と同じく、実績工数(actual_hours)を
 * 社内専用の別表 task_internal_metrics の埋め込みから平らにして返す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'

const TASK_ROW = {
  id: TASK,
  title: 't',
  actual_hours: 999, // 旧列(つなぎ)の値。埋め込みの値を優先する
  task_internal_metrics: { actual_hours: 4.5 },
}

/** `.eq().eq()...` を何回挟んでも、`.single()` は単一行、それ以外(then)は配列を返すチェイン可能モック */
function makeChain(singleResponse: unknown, arrayResponse: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(arrayResponse)
        if (prop === 'single' || prop === 'maybeSingle') return async () => singleResponse
        return () => proxy
      },
    }
  )
  return proxy
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return makeChain({ data: { org_id: ORG }, error: null }, { data: [], error: null })
      if (table === 'tasks') {
        return makeChain({ data: TASK_ROW, error: null }, { data: [TASK_ROW], error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async () => ({ error: null }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { ballPass, ballQuery } = await import('./ball.js')

describe('ball_pass / ball_query — actual_hours は task_internal_metrics の埋め込みから読む', () => {
  it('ball_pass: 埋め込みの値を actual_hours として返す', async () => {
    const result = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [],
    })
    expect(result.task.actual_hours).toBe(4.5)
  })

  it('ball_query: 一覧の各行も埋め込みの値を actual_hours として返す', async () => {
    const result = await ballQuery({ spaceId: SPACE, ball: 'internal', includeOwners: false, limit: 50 })
    expect(result.tasks[0].actual_hours).toBe(4.5)
  })
})

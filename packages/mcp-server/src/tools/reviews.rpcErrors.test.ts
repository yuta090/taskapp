import { describe, it, expect, vi } from 'vitest'

/**
 * review_open / review_approve / review_block は、_asのRPCが RAISE EXCEPTION で
 * 返す断りの理由を、決まった日本語の ToolUserError に置き換える。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'

const TASK_ROW = { id: TASK }

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

let rpcError: { message: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return makeChain({ data: { org_id: ORG }, error: null }, { data: [], error: null })
      if (table === 'tasks') return makeChain({ data: TASK_ROW, error: null }, { data: [TASK_ROW], error: null })
      if (table === 'space_memberships')
        return makeChain(
          { data: { user_id: ACTOR, role: 'editor' }, error: null },
          { data: [{ user_id: ACTOR, role: 'editor' }], error: null }
        )
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async () => ({ error: rpcError }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: ACTOR }) }))

const { reviewOpen, reviewApprove, reviewBlock } = await import('./reviews.js')

describe('review_open / review_approve / review_block — RPCの断りの理由を決まった日本語にする', () => {
  it('review_open: 社内の管理者/編集者でなければ ToolUserError(403)', async () => {
    rpcError = { message: 'Insufficient permissions: you must be an admin or editor in this space' }

    const err = await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: [ACTOR] }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('review_approve: レビュアーでない人が承認しようとすると ToolUserError(403)', async () => {
    rpcError = { message: 'User is not a reviewer for this task' }

    const err = await reviewApprove({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('review_block: レビューが見つからなければ ToolUserError(404)', async () => {
    rpcError = { message: 'No review found for task: abc' }

    const err = await reviewBlock({ spaceId: SPACE, taskId: TASK, reason: '差し戻し' }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })
})

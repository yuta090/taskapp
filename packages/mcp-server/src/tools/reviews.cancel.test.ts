import { describe, it, expect, vi } from 'vitest'

/**
 * review_cancel（社内承認の依頼を取り消す）。画面の「レビューを取り消す」と同じことを
 * CLI / AI秘書からできるようにするための道具。
 *
 * - CLI が持っているのはタスクの UUID なので、取り消す対象の review は task_id から引き当てる
 * - 実行者は鍵に紐づく利用者。auth.uid() 頼みの rpc_review_cancel ではなく
 *   rpc_review_cancel_as を呼ぶ（鍵で動く道具にはログイン中の利用者がいない）
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'
const REVIEW = '00000000-0000-0000-0000-000000000011'

let taskRow: { id: string } | null = { id: TASK }

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

let reviewRow: { id: string; status: string } | null = { id: REVIEW, status: 'open' }
let rpcError: { message: string } | null = null
let authContextUserId: string | null = ACTOR
const rpcCalls: Array<{ name: string; params: unknown }> = []

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return makeChain({ data: { org_id: ORG }, error: null }, { data: [], error: null })
      if (table === 'tasks')
        return makeChain(
          { data: taskRow, error: taskRow ? null : { code: 'PGRST116' } },
          { data: taskRow ? [taskRow] : [], error: null }
        )
      if (table === 'reviews')
        return makeChain({ data: reviewRow, error: null }, { data: reviewRow ? [reviewRow] : [], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { data: null, error: rpcError }
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: authContextUserId }) }))

const { reviewCancel, reviewTools, reviewListSchema } = await import('./reviews.js')

function resetState() {
  rpcCalls.length = 0
  rpcError = null
  taskRow = { id: TASK }
  reviewRow = { id: REVIEW, status: 'open' }
  authContextUserId = ACTOR
}

describe('review_cancel — 承認依頼を取り消す', () => {
  it('rpc_review_cancel_as に、実行者とタスクから引き当てた依頼を渡す', async () => {
    resetState()

    await expect(reviewCancel({ spaceId: SPACE, taskId: TASK })).resolves.toEqual({ ok: true })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_review_cancel_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_review_id: REVIEW })
  })

  it('差し戻し中の依頼も取り消せる（画面と同じ）', async () => {
    resetState()
    reviewRow = { id: REVIEW, status: 'changes_requested' }

    await expect(reviewCancel({ spaceId: SPACE, taskId: TASK })).resolves.toEqual({ ok: true })
    expect(rpcCalls[0].name).toBe('rpc_review_cancel_as')
  })

  it('このタスクに依頼が無ければ ToolUserError(404) で断る（DB を呼びに行かない）', async () => {
    resetState()
    reviewRow = null

    const err = await reviewCancel({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    resetState()
    authContextUserId = null

    const err = await reviewCancel({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('終わった依頼は取り消せない — DB の断りを 409 の日本語にする', async () => {
    resetState()
    reviewRow = { id: REVIEW, status: 'approved' }
    rpcError = { message: 'Review cannot be cancelled from status: approved' }

    const err = await reviewCancel({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('社内承認済み')
  })

  it('依頼した本人・管理者・オーナー以外は取り消せない — DB の断りを 403 の日本語にする', async () => {
    resetState()
    rpcError = {
      message:
        'Insufficient permissions: only the requester, a space admin, or an org owner can cancel this review',
    }

    const err = await reviewCancel({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  // 打ち間違い・別プロジェクトのタスクは、素の Error にすると HTTP API で
  // 「Internal server error」500 に化けて、CLI にも AI秘書にも理由が届かない
  it('タスクが見つからなければ ToolUserError(404) で理由を返す', async () => {
    resetState()
    taskRow = null

    const err = await reviewCancel({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('道具の一覧に review_cancel が並ぶ（CLI から呼べる）', () => {
    expect(reviewTools.map((t) => t.name)).toContain('review_cancel')
  })

  // 取り消したものを一覧で確かめられないと、取り消せたのか分からない
  it('レビュー一覧の絞り込みで cancelled を選べる', () => {
    expect(reviewListSchema.parse({ spaceId: SPACE, status: 'cancelled' }).status).toBe('cancelled')
  })
})

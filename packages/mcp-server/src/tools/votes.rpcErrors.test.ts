import { describe, it, expect, vi } from 'vitest'

/**
 * vote_cast は、rpc_doc_vote_cast_as が RAISE EXCEPTION で返す断りの理由（DOC_VOTE_SPEC §4.3）を、
 * 決まった日本語の ToolUserError に置き換える。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const POLL = '00000000-0000-0000-0000-000000000f01'
const ACTOR = '00000000-0000-0000-0000-000000000099'

function makeChain(singleResponse: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(singleResponse)
        if (prop === 'single' || prop === 'maybeSingle') return async () => singleResponse
        return () => proxy
      },
    }
  )
  return proxy
}

let rpcError: { code?: string; message?: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'doc_polls') return makeChain({ data: { id: POLL }, error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async () => ({ data: null, error: rpcError }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: ACTOR }) }))

const { voteCast } = await import('./votes.js')

describe('vote_cast — RPCの断りの理由を決まった日本語にする', () => {
  it('reason_required は ToolUserError(400)・NG/保留は理由が必要という文言', async () => {
    rpcError = { code: '22023', message: 'reason_required' }
    const err = await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ng' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400, message: 'NG と保留は理由を書いてください' })
  })

  it('memo_too_long は ToolUserError(400)', async () => {
    rpcError = { code: '22023', message: 'memo_too_long' }
    const err = await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ok' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400, message: 'メモは2000字までです' })
  })

  it('invalid_choice は ToolUserError(400)', async () => {
    rpcError = { code: '22023', message: 'invalid_choice' }
    const err = await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ok' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })

  it('forbidden(42501) は ToolUserError(403)・存在しない投票と同じ文言', async () => {
    rpcError = { code: '42501', message: 'forbidden' }
    const err = await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ok' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403, message: 'この投票には押せません' })
  })

  it('認識できない理由は中身を隠した一般的なエラーのまま', async () => {
    rpcError = { code: '99999', message: 'something_internal' }
    const err = await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ok' }).catch((e: unknown) => e)
    expect((err as Error).message).toBe('投票に失敗しました')
    expect((err as { name?: string }).name).not.toBe('ToolUserError')
  })
})

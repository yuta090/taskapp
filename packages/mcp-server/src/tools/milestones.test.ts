import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * milestone_update の回帰: milestones テーブルに updated_at 列は無い（id/org_id/space_id/name/due_date/
 * order_key/created_at のみ）。updated_at を送ると PostgREST が
 * "Could not find the 'updated_at' column of 'milestones' in the schema cache" で落ち、
 * CLI の `agentpm milestone update` が一度も成功しない状態だった（本番で踏んだ）。
 */
const updates: Record<string, unknown>[] = []
const inserts: Record<string, unknown>[] = []
let singleResult: { data: unknown; error: { code?: string; message?: string } | null } = {
  data: { id: 'm-1', name: 'M', due_date: '2026-09-09' },
  error: null,
}
const chain = {
  insert: (payload: Record<string, unknown>) => { inserts.push(payload); return chain },
  update: (payload: Record<string, unknown>) => { updates.push(payload); return chain },
  eq: () => chain,
  select: () => chain,
  single: async () => singleResult,
}
vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => (table === 'spaces'
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      : chain),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { milestoneCreate, milestoneUpdate, milestoneGet } = await import('./milestones.js')

beforeEach(() => {
  singleResult = { data: { id: 'm-1', name: 'M', due_date: '2026-09-09' }, error: null }
})

describe('milestone_update', () => {
  it('存在しない updated_at 列を送らない（due_date だけを更新する）', async () => {
    await milestoneUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', milestoneId: '00000000-0000-0000-0000-000000000001', dueDate: '2026-09-09' })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({ due_date: '2026-09-09' })
    expect(updates[0]).not.toHaveProperty('updated_at')
  })
})

/**
 * order_key の単位の回帰: 画面（useMilestones.ts・TaskCreateSheet.tsx）は Date.now()
 * （ミリ秒）を order_key に使う。CLI/MCP がここを秒（Date.now() / 1000）で作ると、
 * あとから CLI で作ったマイルストーンが先に画面で作ったものより order_key が小さくなり、
 * 並び順で前に出てしまう。画面と同じミリ秒で保存することを確認する。
 */
describe('milestone_create', () => {
  it('order_key は画面と同じ単位（Date.now() のミリ秒）で保存する', async () => {
    const fixedNowMs = 1_757_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs)
    try {
      await milestoneCreate({ spaceId: '00000000-0000-0000-0000-000000000010', name: 'M' })
    } finally {
      vi.restoreAllMocks()
    }
    expect(inserts).toHaveLength(1)
    expect(inserts[0].order_key).toBe(fixedNowMs)
  })
})

/**
 * milestone_get / milestone_update は、共通の notFoundOr（dbErrors.ts）を使う。
 * .single() が0件（PGRST116）のときだけ見つからない旨の404、それ以外は一般のエラーにする。
 */
describe('milestone_get / milestone_update — 見つからない場合と、それ以外のDBエラー', () => {
  it('milestone_get: PGRST116なら見つからない旨の404', async () => {
    singleResult = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }

    const err = await milestoneGet({
      spaceId: '00000000-0000-0000-0000-000000000010',
      milestoneId: '00000000-0000-0000-0000-000000000001',
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect((err as Error).message).toBe('マイルストーンが見つかりません')
  })

  it('milestone_get: それ以外のDBエラーは中身を隠した一般のエラー', async () => {
    singleResult = { data: null, error: { code: '42501', message: 'permission denied for table milestones' } }

    const err = await milestoneGet({
      spaceId: '00000000-0000-0000-0000-000000000010',
      milestoneId: '00000000-0000-0000-0000-000000000001',
    }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('milestone_update: PGRST116なら見つからない旨の404', async () => {
    singleResult = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }

    const err = await milestoneUpdate({
      spaceId: '00000000-0000-0000-0000-000000000010',
      milestoneId: '00000000-0000-0000-0000-000000000001',
      name: '新しい名前',
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect((err as Error).message).toBe('マイルストーンが見つかりません')
  })

  it('milestone_update: それ以外のDBエラーは中身を隠した一般のエラー', async () => {
    singleResult = { data: null, error: { code: '42501', message: 'permission denied for table milestones' } }

    const err = await milestoneUpdate({
      spaceId: '00000000-0000-0000-0000-000000000010',
      milestoneId: '00000000-0000-0000-0000-000000000001',
      name: '新しい名前',
    }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

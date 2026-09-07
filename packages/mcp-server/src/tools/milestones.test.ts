import { describe, it, expect, vi } from 'vitest'

/**
 * milestone_update の回帰: milestones テーブルに updated_at 列は無い（id/org_id/space_id/name/due_date/
 * order_key/created_at のみ）。updated_at を送ると PostgREST が
 * "Could not find the 'updated_at' column of 'milestones' in the schema cache" で落ち、
 * CLI の `agentpm milestone update` が一度も成功しない状態だった（本番で踏んだ）。
 */
const updates: Record<string, unknown>[] = []
const chain = {
  update: (payload: Record<string, unknown>) => { updates.push(payload); return chain },
  eq: () => chain,
  select: () => chain,
  single: async () => ({ data: { id: 'm-1', name: 'M', due_date: '2026-09-09' }, error: null }),
}
vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => (table === 'spaces'
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      : chain),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { milestoneUpdate } = await import('./milestones.js')

describe('milestone_update', () => {
  it('存在しない updated_at 列を送らない（due_date だけを更新する）', async () => {
    await milestoneUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', milestoneId: '00000000-0000-0000-0000-000000000001', dueDate: '2026-09-09' })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({ due_date: '2026-09-09' })
    expect(updates[0]).not.toHaveProperty('updated_at')
  })
})

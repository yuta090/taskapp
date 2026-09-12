import { describe, it, expect, vi } from 'vitest'

/**
 * respond_to_proposal / cancel_scheduling_proposal / send_proposal_reminder は、
 * 提案の状態(status)が open でないときのメッセージに、決まった日本語のラベルを使う
 * （英語の値をそのまま出さない）。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PROPOSAL = '00000000-0000-0000-0000-000000000003'
const ACTOR = '00000000-0000-0000-0000-000000000099'

let proposalRow: Record<string, unknown> = { id: PROPOSAL, status: 'cancelled', space_id: SPACE }

function chain() {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: proposalRow, error: null })
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: proposalRow, error: null })
        return () => proxy
      },
    }
  )
  return proxy
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'scheduling_proposals') return chain()
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin' }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'fallback-actor' },
  getAuthContext: () => ({ userId: ACTOR }),
}))

const { schedulingRespond, schedulingCancel, schedulingSendReminder } = await import('./scheduling.js')

describe('日程調整の提案 — 状態(status)は日本語のラベルで出す', () => {
  it('respond_to_proposal: openでない提案への回答は日本語のラベルで断る', async () => {
    proposalRow = { id: PROPOSAL, status: 'cancelled', space_id: SPACE }

    const err = await schedulingRespond({
      spaceId: SPACE,
      proposalId: PROPOSAL,
      responses: [{ slotId: '00000000-0000-0000-0000-000000000004', response: 'available' }],
    }).catch((e: unknown) => e)

    expect((err as Error).message).toContain('キャンセル済み')
    expect((err as Error).message).not.toContain('cancelled')
  })

  it('cancel_scheduling_proposal: openでない提案の変更は日本語のラベルで断る', async () => {
    proposalRow = { id: PROPOSAL, status: 'confirmed', space_id: SPACE, created_by: ACTOR }

    const err = await schedulingCancel({ spaceId: SPACE, proposalId: PROPOSAL, action: 'cancel' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).toContain('確定済み')
    expect((err as Error).message).not.toContain('confirmed')
  })

  it('send_proposal_reminder: openでない提案へのリマインドは日本語のラベルで断る', async () => {
    proposalRow = { id: PROPOSAL, status: 'expired', space_id: SPACE, org_id: 'org-1', expires_at: null, title: 't' }

    const err = await schedulingSendReminder({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)

    expect((err as Error).message).toContain('期限切れ')
    expect((err as Error).message).not.toContain('expired')
  })
})

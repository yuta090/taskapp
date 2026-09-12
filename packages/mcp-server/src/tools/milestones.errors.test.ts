import { describe, it, expect, vi } from 'vitest'

/**
 * milestone_get / milestone_update は、対象が見つからない（PGRST116）ときは
 * ToolUserError(404)「マイルストーンが見つかりません」で断る（/api/tools が
 * 中身を隠した一般の500に潰さず、理由が呼んだ人に届く）。
 * それ以外のDBの理由は、生の文言を出さずに一般のエラーのまま返す（中身は隠す）。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const MILESTONE = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

let singleResponse: { data: unknown; error: unknown } = { data: null, error: null }

function chain() {
  const obj: Record<string, unknown> = {
    select: () => obj,
    update: () => obj,
    eq: () => obj,
    single: async () => singleResponse,
  }
  return obj
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG }, error: null }) }) }) }
        : chain(),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { milestoneGet, milestoneUpdate } = await import('./milestones.js')

describe('milestone_get / milestone_update — 見つからない場合とそれ以外のDBの理由', () => {
  it('milestone_get: PGRST116（0件）なら ToolUserError(404) で、生のDB文言は出さない', async () => {
    singleResponse = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }

    const err = await milestoneGet({ spaceId: SPACE, milestoneId: MILESTONE }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect((err as Error).message).not.toContain('JSON object requested')
  })

  it('milestone_update: PGRST116（0件）なら ToolUserError(404) で、生のDB文言は出さない', async () => {
    singleResponse = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }

    const err = await milestoneUpdate({ spaceId: SPACE, milestoneId: MILESTONE, name: '新しい名前' }).catch(
      (e: unknown) => e
    )

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect((err as Error).message).not.toContain('JSON object requested')
  })

  it('milestone_get: それ以外のDBの理由は、生の文言を出さない一般のエラーのまま', async () => {
    singleResponse = { data: null, error: { code: '42501', message: 'permission denied for table milestones' } }

    const err = await milestoneGet({ spaceId: SPACE, milestoneId: MILESTONE }).catch((e: unknown) => e)

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect((err as Error).message).not.toContain('permission denied')
  })
})

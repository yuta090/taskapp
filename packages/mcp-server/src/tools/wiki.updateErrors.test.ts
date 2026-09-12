import { describe, it, expect, vi } from 'vitest'

/**
 * wiki_update は、DB トリガーが親子・マイルストーンの境界/循環で断ったとき、
 * 決まった日本語の ToolUserError（400）で返す（/api/tools が中身を隠した
 * 一般の500に潰さず、理由が呼んだ人に届く）。見覚えのない理由は一般のエラーのまま。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

let updateError: { message: string } | null = null

function chain() {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    update: () => obj,
    single: async () => ({ data: null, error: updateError }),
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

const { wikiUpdate } = await import('./wiki.js')

describe('wiki_update — DBトリガーの断りは決まった日本語のToolUserErrorにする', () => {
  it('親ページの循環はToolUserError(400)で、決まった日本語が届く', async () => {
    updateError = { message: 'wiki parent cycle detected' }

    const err = await wikiUpdate({ spaceId: SPACE, pageId: PAGE, title: 't' }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect((err as Error).message).toContain('循環')
  })

  it('見覚えのない理由は一般のエラーのまま（ToolUserErrorにしない）', async () => {
    updateError = { message: 'some unexpected internal detail' }

    const err = await wikiUpdate({ spaceId: SPACE, pageId: PAGE, title: 't' }).catch((e: unknown) => e)

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
  })
})

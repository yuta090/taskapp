import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * minutes_toc: 目次の目印（`<!--toc-->`）の追加/削除。
 * 追加は見出し1（`# `）の直後（無ければ先頭）に入れ、既にあれば何もしない（冪等）。
 * 削除は目印が無ければ何もしない。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEETING = '00000000-0000-0000-0000-000000000099'
const ORG = 'org-1'

let minutesMd = ''
const updates: Array<{ minutes_md: string }> = []

function meetingsChain() {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.single = async () => ({ data: { id: MEETING, org_id: ORG, space_id: SPACE, minutes_md: minutesMd, updated_at: 't0' }, error: null })
  c.update = (payload: { minutes_md: string }) => {
    updates.push(payload)
    const u: Record<string, unknown> = {}
    u.eq = () => u
    u.select = async () => ({ data: [{ id: MEETING, minutes_md: payload.minutes_md, updated_at: 't1' }], error: null })
    return u
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG }, error: null }) }) }) }
        : meetingsChain(),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { minutesToc } = await import('./minutes.js')

beforeEach(() => {
  minutesMd = ''
  updates.length = 0
})

describe('minutes_toc — add', () => {
  it('見出し1の直後に目次の行を入れる', async () => {
    minutesMd = '# 題名\n本文'

    await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'add' })

    expect(updates).toHaveLength(1)
    expect(updates[0].minutes_md).toBe('# 題名\n<!--toc-->\n本文')
  })

  it('見出し1が無ければ先頭に入れる', async () => {
    minutesMd = '## 小見出し\n本文'

    await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'add' })

    expect(updates[0].minutes_md).toBe('<!--toc-->\n## 小見出し\n本文')
  })

  it('議事録が空でも先頭に入れる', async () => {
    minutesMd = ''

    await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'add' })

    expect(updates[0].minutes_md).toBe('<!--toc-->')
  })

  it('既に目次があれば何もしない（冪等）', async () => {
    minutesMd = '# 題名\n<!--toc-->\n本文'

    const result = await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'add' })

    expect(updates).toHaveLength(0)
    expect(result.minutes_md).toBe(minutesMd)
  })

  it('action を省略すると add になる', async () => {
    minutesMd = '# 題名'

    await minutesToc({ spaceId: SPACE, meetingId: MEETING } as never)

    expect(updates[0].minutes_md).toBe('# 題名\n<!--toc-->')
  })
})

describe('minutes_toc — remove', () => {
  it('目次の行を外す', async () => {
    minutesMd = '# 題名\n<!--toc-->\n本文'

    await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'remove' })

    expect(updates[0].minutes_md).toBe('# 題名\n本文')
  })

  it('目次が無ければ何もしない', async () => {
    minutesMd = '# 題名\n本文'

    const result = await minutesToc({ spaceId: SPACE, meetingId: MEETING, action: 'remove' })

    expect(updates).toHaveLength(0)
    expect(result.minutes_md).toBe(minutesMd)
  })
})

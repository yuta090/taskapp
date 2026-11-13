import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * meeting_update: 作ったあとの会議の題名・開催日時を CLI から直す。
 * Web にも直す画面が無く、日時を間違えて作った会議を直す手段が無かった（2026-11-11）。
 * 他の人の更新を黙って消さないよう、minutes_update と同じ expectedUpdatedAt（楽観ロック）を受ける。
 */
type Call = { table: string; op: string; payload?: unknown; eqs: Array<[string, unknown]> }
const calls: Call[] = []
let updateRows: unknown[] = [{ id: 'm-1', title: '新しい題名' }]

function chain(table: string) {
  const call: Call = { table, op: 'select', eqs: [] }
  calls.push(call)
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = (k: string, v: unknown) => {
    call.eqs.push([k, v])
    return c
  }
  c.update = (payload: unknown) => {
    call.op = 'update'
    call.payload = payload
    return c
  }
  c.single = async () => ({ data: { org_id: 'org-1' }, error: null })
  c.then = (resolve: (v: unknown) => unknown) =>
    resolve(call.op === 'update' ? { data: updateRows, error: null } : { data: [], error: null })
  return c
}

const checkAuth = vi.fn(async () => ({ ctx: {}, role: 'admin' }))
vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('../auth/helpers.js', () => ({ checkAuth: (...a: unknown[]) => checkAuth(...(a as [])) }))

const { meetingUpdate, meetingUpdateSchema, meetingTools } = await import('./meetings.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEETING = '00000000-0000-0000-0000-000000000020'
const updateCall = () => calls.find((c) => c.op === 'update')

beforeEach(() => {
  calls.length = 0
  updateRows = [{ id: 'm-1', title: '新しい題名' }]
  checkAuth.mockClear()
})

describe('meeting_update', () => {
  it('題名と開催日時を、その組織・スペースの会議に限って書き換える', async () => {
    const res = await meetingUpdate({
      spaceId: SPACE,
      meetingId: MEETING,
      title: '新しい題名',
      heldAt: '2026-11-12T15:00:00+09:00',
    })

    expect(checkAuth).toHaveBeenCalledWith(SPACE, 'write', 'meeting_update', 'meeting', MEETING)
    expect(updateCall()).toMatchObject({
      table: 'meetings',
      payload: { title: '新しい題名', held_at: '2026-11-12T15:00:00+09:00' },
    })
    expect(updateCall()!.eqs).toEqual(
      expect.arrayContaining([
        ['id', MEETING],
        ['org_id', 'org-1'],
        ['space_id', SPACE],
      ])
    )
    expect(res).toMatchObject({ id: 'm-1' })
  })

  it('渡した項目だけを書き換える（題名だけなら日時は送らない）', async () => {
    await meetingUpdate({ spaceId: SPACE, meetingId: MEETING, title: '題名だけ' })

    expect(updateCall()!.payload).toEqual({ title: '題名だけ' })
  })

  it('expectedUpdatedAt を渡したら、その版の行だけを書く', async () => {
    await meetingUpdate({ spaceId: SPACE, meetingId: MEETING, title: 't', expectedUpdatedAt: '2026-11-11T00:00:00Z' })

    expect(updateCall()!.eqs).toContainEqual(['updated_at', '2026-11-11T00:00:00Z'])
  })

  it('版が変わっていて0行なら、競合として断る', async () => {
    updateRows = []
    await expect(
      meetingUpdate({ spaceId: SPACE, meetingId: MEETING, title: 't', expectedUpdatedAt: '2026-11-11T00:00:00Z' })
    ).rejects.toMatchObject({ name: 'StaleWriteError' })
  })

  it('版を渡さずに0行なら「会議が見つかりません」', async () => {
    updateRows = []
    await expect(meetingUpdate({ spaceId: SPACE, meetingId: MEETING, title: 't' })).rejects.toThrow('会議が見つかりません')
  })

  it('直す項目が1つも無ければ、書かずに断る（400）', async () => {
    await expect(meetingUpdate({ spaceId: SPACE, meetingId: MEETING })).rejects.toMatchObject({
      name: 'ToolUserError',
      status: 400,
    })
    expect(updateCall()).toBeUndefined()
  })

  it('スキーマは MCP の登録に要る shape を持つ（refine で包まない）', () => {
    expect(Object.keys(meetingUpdateSchema.shape)).toEqual(
      expect.arrayContaining(['spaceId', 'meetingId', 'title', 'heldAt', 'expectedUpdatedAt'])
    )
  })

  it('時差の無い日時は断る（UTC として9時間ずれて入るため）', () => {
    const r = meetingUpdateSchema.safeParse({ spaceId: SPACE, meetingId: MEETING, heldAt: '2026-11-12T15:00' })
    expect(r.success).toBe(false)
    expect(
      meetingUpdateSchema.safeParse({ spaceId: SPACE, meetingId: MEETING, heldAt: '2026-11-12T06:00:00Z' }).success
    ).toBe(true)
  })

  it('空の題名は断る', () => {
    expect(meetingUpdateSchema.safeParse({ spaceId: SPACE, meetingId: MEETING, title: '' }).success).toBe(false)
  })

  it('MCP のツール一覧に meeting_update がある', () => {
    expect(meetingTools.map((t) => t.name)).toContain('meeting_update')
  })
})

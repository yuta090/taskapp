import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPortalMeetingsData } from '@/lib/portal/fetchPortalMeetingsData'
import { TASKS_PAGE_SIZE } from '@/lib/supabase/queries'

/**
 * `/portal/meetings`（お客さん向けポータルの会議一覧）は、以前 `.limit(50)` で
 * 打ち切っていたため会議数が51件を超えると古い会議が静かに一覧から消えていた。
 * tasks / fetchMeetingsQuery と同じ range ページング（TASKS_PAGE_SIZE件ずつ）で
 * 全件読み切ることを確かめる。
 *
 * ただし社内一覧の fetchMeetingsQuery と違い、ポータルは「1ページ目の取得に
 * 失敗しても空データで表示を続ける」graceful degradation 方針を守る必要がある
 * ため、reject ではなく空配列/前ページまでのデータを返すことを検証する。
 */

interface MeetingsPageResult {
  data: unknown[] | null
  error: unknown
}

type MeetingsChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  range: ReturnType<typeof vi.fn>
}

function makeMeetingsChain(pageResults: MeetingsPageResult[]): MeetingsChain {
  const chain = {} as MeetingsChain
  let pageCall = 0
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.range = vi.fn(() => {
    const result = pageResults[pageCall] ?? { data: [], error: null }
    pageCall += 1
    return Promise.resolve(result)
  })
  return chain
}

function makeMeeting(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `meeting-${id}`,
    held_at: '2026-09-01T10:00:00',
    status: 'ended',
    minutes_md: null,
    summary_subject: null,
    summary_body: null,
    started_at: null,
    ended_at: null,
    ...overrides,
  }
}

function makeTasksCountChain(result: { count: number | null; error: unknown }) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.neq = vi.fn(() => Promise.resolve(result))
  return chain
}

function makeSupabase(
  meetingsChain: MeetingsChain,
  tasksResult: { count: number | null; error: unknown } = { count: 0, error: null }
) {
  const from = vi.fn((table: string) => {
    if (table === 'meetings') return meetingsChain
    if (table === 'tasks') return makeTasksCountChain(tasksResult)
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as SupabaseClient
}

describe('fetchPortalMeetingsData — 全件をページングで読む', () => {
  it('50件を超えても、TASKS_PAGE_SIZE件未満なら1回のリクエストで全件返る（.limit(50)による打ち切りが無い）', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => makeMeeting(String(i)))
    const meetingsChain = makeMeetingsChain([{ data: rows, error: null }])
    const supabase = makeSupabase(meetingsChain)

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    expect(result.meetings).toHaveLength(120)
    expect(meetingsChain.range).toHaveBeenCalledTimes(1)
    expect(meetingsChain.range).toHaveBeenCalledWith(0, TASKS_PAGE_SIZE - 1)
  })

  it('1ページ目がちょうどTASKS_PAGE_SIZE件のときだけ2ページ目を取得する', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeMeeting(`p1-${i}`))
    const page2 = [makeMeeting('p2-0'), makeMeeting('p2-1')]
    const meetingsChain = makeMeetingsChain([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const supabase = makeSupabase(meetingsChain)

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    expect(result.meetings).toHaveLength(TASKS_PAGE_SIZE + 2)
    expect(meetingsChain.range).toHaveBeenCalledTimes(2)
    expect(meetingsChain.range).toHaveBeenNthCalledWith(1, 0, TASKS_PAGE_SIZE - 1)
    expect(meetingsChain.range).toHaveBeenNthCalledWith(2, TASKS_PAGE_SIZE, TASKS_PAGE_SIZE * 2 - 1)
  })

  it('.limit(50) を使っていない（.limit は一切呼ばれない）', async () => {
    const meetingsChain = makeMeetingsChain([{ data: [makeMeeting('a')], error: null }])
    const supabase = makeSupabase(meetingsChain)

    await fetchPortalMeetingsData(supabase, 'space-1')

    expect((meetingsChain as unknown as { limit?: unknown }).limit).toBeUndefined()
  })

  it('held_at 降順・id 降順（タイブレーク）で並び替えている', async () => {
    const meetingsChain = makeMeetingsChain([{ data: [makeMeeting('a')], error: null }])
    const supabase = makeSupabase(meetingsChain)

    await fetchPortalMeetingsData(supabase, 'space-1')

    expect(meetingsChain.order).toHaveBeenNthCalledWith(1, 'held_at', { ascending: false })
    expect(meetingsChain.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false })
  })

  it('ページ境界で重複した行（同じid）は1件にまとめる', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeMeeting(`p1-${i}`))
    const overlappingId = page1[page1.length - 1].id // 'p1-999'
    const page2 = [makeMeeting(overlappingId), makeMeeting('p2-1')]
    const meetingsChain = makeMeetingsChain([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const supabase = makeSupabase(meetingsChain)

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    const ids = result.meetings.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.meetings).toHaveLength(TASKS_PAGE_SIZE + 1)
  })

  it('2ページ目の取得が失敗しても、例外で落ちず1ページ目の行だけで表示を続ける', async () => {
    const page1 = Array.from({ length: TASKS_PAGE_SIZE }, (_, i) => makeMeeting(`p1-${i}`))
    const meetingsChain = makeMeetingsChain([
      { data: page1, error: null },
      { data: null, error: { message: 'page2 boom' } },
    ])
    const supabase = makeSupabase(meetingsChain)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    expect(result.meetings).toHaveLength(TASKS_PAGE_SIZE)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('1ページ目の取得が失敗したときは、空データで続行する（従来どおり）', async () => {
    const meetingsChain = makeMeetingsChain([{ data: null, error: { message: 'page1 boom' } }])
    const supabase = makeSupabase(meetingsChain)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    expect(result.meetings).toEqual([])
    expect(meetingsChain.range).toHaveBeenCalledTimes(1)
  })

  it('actionCount(tasks件数)を並列取得し、結果に含める', async () => {
    const meetingsChain = makeMeetingsChain([{ data: [makeMeeting('a')], error: null }])
    const supabase = makeSupabase(meetingsChain, { count: 3, error: null })

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    expect(result.actionCount).toBe(3)
  })

  it('会議データをクライアント表示用の形（heldAt/minutesMd等）に整形する', async () => {
    const meetingsChain = makeMeetingsChain([
      {
        data: [
          makeMeeting('a', {
            title: 'キックオフ',
            held_at: '2026-09-01T10:00:00',
            minutes_md: '# 議事録',
            summary_subject: '件名',
            summary_body: '本文',
            started_at: '2026-09-01T10:00:00',
            ended_at: '2026-09-01T11:00:00',
          }),
        ],
        error: null,
      },
    ])
    const supabase = makeSupabase(meetingsChain)

    const result = await fetchPortalMeetingsData(supabase, 'space-1')

    expect(result.meetings[0]).toEqual({
      id: 'a',
      title: 'キックオフ',
      heldAt: '2026-09-01T10:00:00',
      status: 'ended',
      minutesMd: '# 議事録',
      summarySubject: '件名',
      summaryBody: '本文',
      startedAt: '2026-09-01T10:00:00',
      endedAt: '2026-09-01T11:00:00',
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseMeetingMinutes } from '@/lib/supabase/rpc'
import { MinutesConflictError, MINUTES_STALE_MESSAGE } from '@/lib/minutes/errors'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// 議事録のタスク化（rpc_parse_meeting_minutes）は、渡された本文で meetings.minutes_md を
// 書き換える。DB 側は「渡された本文が、いま DB にある本文と同じか」を確かめ、違っていたら
// 何も書かずに hint='minutes_stale' の例外を投げる（隙間に入った他の人・AI秘書の書き込みを
// 消さないため）。ここでは、その例外を画面が扱える MinutesConflictError に言い換えることを
// 検証する（画面は instanceof で競合の帯を出すため、素の Error では区別できない）。

type Client = SupabaseClient<Database>

interface PostgresErrorLike {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

function makeClient(result: { data?: unknown; error?: PostgresErrorLike | null }): Client {
  return { rpc: vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }) } as unknown as Client
}

const SUCCESS = {
  ok: true,
  created_count: 1,
  created_tasks: [
    { task_id: 't1', title: '仕様を決める', spec_path: '/spec/a.md#x', due_date: null, line_number: 3 },
  ],
  updated_minutes: '- [ ] SPEC(/spec/a.md#x): 仕様を決める <!--task:t1-->',
}

beforeEach(() => {
  // 失敗の経路では callRpc が console.error を出す（本番のログはそのまま残したいので
  // 黙らせるのはテストの中だけ）
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseMeetingMinutes: 別の場所で更新されていたときの言い換え', () => {
  it("hint='minutes_stale' なら MinutesConflictError にし、DB の文をそのまま持たせる", async () => {
    const client = makeClient({
      error: {
        message: 'この議事録は、別の場所で更新されています。最新を読み込んでからもう一度お試しください',
        code: 'P0001',
        hint: 'minutes_stale',
        details: null,
      },
    })

    const promise = parseMeetingMinutes(client, { meetingId: 'm1', minutesMd: '本文' })
    await expect(promise).rejects.toBeInstanceOf(MinutesConflictError)
    await expect(promise).rejects.toThrow('この議事録は、別の場所で更新されています')
  })

  it('hint が届かなくても、message に「別の場所で更新されています」があれば MinutesConflictError にする', async () => {
    // PostgREST の構成によっては hint が落ちることがあるため、message でも拾う
    const client = makeClient({
      error: {
        message: 'この議事録は、別の場所で更新されています。最新を読み込んでからもう一度お試しください',
        code: 'P0001',
      },
    })

    await expect(parseMeetingMinutes(client, { meetingId: 'm1', minutesMd: '本文' })).rejects.toBeInstanceOf(
      MinutesConflictError
    )
  })

  it('DB の文面が空でも、機械語（minutes_stale）を画面に出さない', async () => {
    // PostgREST から message も details も空で hint だけ届いた場合。以前は hint がそのまま
    // 画面の文になり「minutes_stale」と出ていた。
    const client = makeClient({ error: { message: '', code: 'P0001', details: null, hint: 'minutes_stale' } })

    const promise = parseMeetingMinutes(client, { meetingId: 'm1', minutesMd: '本文' })
    await expect(promise).rejects.toThrow(MINUTES_STALE_MESSAGE)
    await expect(promise).rejects.not.toThrow(/minutes_stale/)
  })

  it('競合と分かったときの文は、DB の文面ではなく決まった日本語を使う', async () => {
    // DB 側の文面が変わっても画面の文はぶれない（案内の文は1か所で決める）
    const client = makeClient({
      error: { message: 'minutes is stale (base mismatch)', code: 'P0001', hint: 'minutes_stale' },
    })

    await expect(parseMeetingMinutes(client, { meetingId: 'm1', minutesMd: '本文' })).rejects.toThrow(
      MINUTES_STALE_MESSAGE
    )
  })

  it('競合以外の失敗（権限が無い等）は MinutesConflictError にしない', async () => {
    const client = makeClient({
      error: { message: 'Not authorized to parse minutes for this meeting', code: 'P0001', hint: null },
    })

    const promise = parseMeetingMinutes(client, { meetingId: 'm1', minutesMd: '本文' })
    await expect(promise).rejects.toThrow('Not authorized to parse minutes for this meeting')
    await expect(promise).rejects.not.toBeInstanceOf(MinutesConflictError)
  })

  it('useMeetings からの再輸出は同じ型（既存の import が壊れていない）', async () => {
    const { MinutesConflictError: ReExported } = await import('@/lib/hooks/useMeetings')
    expect(ReExported).toBe(MinutesConflictError)
  })

  it('成功したときのふるまいは変わらない（結果をそのまま返す）', async () => {
    const client = makeClient({ data: SUCCESS })

    await expect(parseMeetingMinutes(client, { meetingId: 'm1', minutesMd: '本文' })).resolves.toEqual(SUCCESS)
    expect(client.rpc).toHaveBeenCalledWith('rpc_parse_meeting_minutes', {
      p_meeting_id: 'm1',
      p_minutes_md: '本文',
    })
  })
})

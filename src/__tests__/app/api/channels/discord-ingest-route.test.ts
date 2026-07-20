import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'node:crypto'

/**
 * POST /api/channels/discord/ingest — HMAC 検証 → handler へ委譲。
 * handler 本体は ingestHandler.test.ts で網羅するため、ここは認証境界と配線のみ検証。
 */
const SECRET = 'test-ingest-secret'
const NOW = Math.floor(Date.now() / 1000)

const handleDiscordIngestMock = vi.fn()
vi.mock('@/lib/channels/discord/ingestHandler', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, handleDiscordIngest: (...a: unknown[]) => handleDiscordIngestMock(...a) }
})
// store/entitlements/admin/client は deps 構築時に import されるだけ（handler mock で未実行）。
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const { POST } = await import('@/app/api/channels/discord/ingest/route')

function sign(rawBody: string, ts: number): string {
  return createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest('hex')
}

function post(body: string, headers: Record<string, string>) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/discord/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DISCORD_INGEST_HMAC_SECRET = SECRET
  handleDiscordIngestMock.mockResolvedValue({ processed: 1, inserted: 1, claimsCreated: 0 })
})

describe('POST /api/channels/discord/ingest', () => {
  it('正しい署名は 200＋handler の集計を返す', async () => {
    const body = JSON.stringify({ events: [{ type: 'message_create' }] })
    const ts = NOW
    const res = await post(body, {
      'x-ingest-timestamp': String(ts),
      'x-ingest-signature': sign(body, ts),
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, processed: 1, inserted: 1 })
    expect(handleDiscordIngestMock).toHaveBeenCalledTimes(1)
    expect(handleDiscordIngestMock.mock.calls[0][0]).toEqual([{ type: 'message_create' }])
  })

  it('署名不一致は 401・handler を呼ばない', async () => {
    const body = JSON.stringify({ events: [] })
    const res = await post(body, {
      'x-ingest-timestamp': String(NOW),
      'x-ingest-signature': 'deadbeef',
    })
    expect(res.status).toBe(401)
    expect(handleDiscordIngestMock).not.toHaveBeenCalled()
  })

  it('署名ヘッダ欠如は 401', async () => {
    const body = JSON.stringify({ events: [] })
    const res = await post(body, {})
    expect(res.status).toBe(401)
  })

  it('secret 未設定は 500（fail-closed・処理しない）', async () => {
    delete process.env.DISCORD_INGEST_HMAC_SECRET
    const body = JSON.stringify({ events: [] })
    const res = await post(body, {
      'x-ingest-timestamp': String(NOW),
      'x-ingest-signature': sign(body, NOW),
    })
    expect(res.status).toBe(500)
    expect(handleDiscordIngestMock).not.toHaveBeenCalled()
  })

  it('署名は正しいが本文が不正JSONなら 400', async () => {
    // 生ボディに対して署名するので、壊れたJSONでも署名は一致させられる
    const body = '{bad'
    const res = await post(body, {
      'x-ingest-timestamp': String(NOW),
      'x-ingest-signature': sign(body, NOW),
    })
    expect(res.status).toBe(400)
    expect(handleDiscordIngestMock).not.toHaveBeenCalled()
  })

  it('events が無い/配列でないなら空配列で handler を呼ぶ', async () => {
    const body = JSON.stringify({ foo: 1 })
    await post(body, {
      'x-ingest-timestamp': String(NOW),
      'x-ingest-signature': sign(body, NOW),
    })
    expect(handleDiscordIngestMock.mock.calls[0][0]).toEqual([])
  })
})

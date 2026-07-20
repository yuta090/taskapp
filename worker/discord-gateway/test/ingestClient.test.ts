import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { signIngestPayload, postIngestBatch } from '../src/ingestClient.js'
import type { IngestEvent } from '../src/normalize.js'

const SECRET = 'test-ingest-secret'

function ev(over: Partial<IngestEvent> = {}): IngestEvent {
  return {
    type: 'message_create',
    guildId: 'G1',
    channelId: 'C1',
    messageId: 'M1',
    author: { id: 'U1', isBot: false },
    content: 'hi',
    timestamp: '2026-07-20T00:00:00.000Z',
    ...over,
  }
}

function okResponse(status = 200) {
  return { status, json: async () => ({ ok: true }) } as unknown as Response
}

describe('signIngestPayload — app の ingestAuth と同一契約', () => {
  it('HMAC-SHA256(`${timestamp}.${rawBody}`) の hex を返す', () => {
    const rawBody = JSON.stringify({ events: [ev()] })
    const ts = '1770000000'
    const expected = createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest('hex')
    expect(signIngestPayload(rawBody, ts, SECRET)).toBe(expected)
  })
})

describe('postIngestBatch', () => {
  it('空配列は送信せず ok（no-op）', async () => {
    const fetchImpl = vi.fn()
    const res = await postIngestBatch([], { url: 'http://x', secret: SECRET, fetchImpl })
    expect(res).toEqual({ ok: true, status: 0, attempts: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('200 は成功。body={events} と HMAC ヘッダを正しく付ける', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(200))
    const events = [ev({ messageId: 'M1' }), ev({ messageId: 'M2' })]
    const res = await postIngestBatch(events, {
      url: 'http://ingest',
      secret: SECRET,
      fetchImpl,
      now: () => 1_770_000_000_000, // ms → 1770000000 s
    })
    expect(res).toEqual({ ok: true, status: 200, attempts: 1 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://ingest')
    expect(init.method).toBe('POST')
    const rawBody = JSON.stringify({ events })
    expect(init.body).toBe(rawBody)
    expect(init.headers['x-ingest-timestamp']).toBe('1770000000')
    expect(init.headers['x-ingest-signature']).toBe(
      createHmac('sha256', SECRET).update(`1770000000.${rawBody}`).digest('hex'),
    )
  })

  it('5xx は再送し、途中で 200 になれば成功（バックオフ待ちはモック）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(500))
      .mockResolvedValueOnce(okResponse(200))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const res = await postIngestBatch([ev()], {
      url: 'http://ingest',
      secret: SECRET,
      fetchImpl,
      sleep,
      backoffMs: () => 1,
    })
    expect(res.ok).toBe(true)
    expect(res.attempts).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('ネットワーク例外も再送対象', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse(200))
    const res = await postIngestBatch([ev()], {
      url: 'http://ingest',
      secret: SECRET,
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      backoffMs: () => 1,
    })
    expect(res.ok).toBe(true)
    expect(res.attempts).toBe(2)
  })

  it('401（署名不一致=恒久エラー）は再送せず即中断', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(401))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const res = await postIngestBatch([ev()], { url: 'http://ingest', secret: SECRET, fetchImpl, sleep })
    expect(res).toEqual({ ok: false, status: 401, attempts: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('400（不正JSON=恒久エラー）も即中断', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(400))
    const res = await postIngestBatch([ev()], { url: 'http://ingest', secret: SECRET, fetchImpl, sleep: vi.fn() })
    expect(res.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('429 は一時エラー扱いで再送する（4xx でも例外）', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse(429)).mockResolvedValueOnce(okResponse(200))
    const res = await postIngestBatch([ev()], {
      url: 'http://ingest',
      secret: SECRET,
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      backoffMs: () => 1,
    })
    expect(res.ok).toBe(true)
    expect(res.attempts).toBe(2)
  })

  it('maxRetries を尽くしたら ok:false（最終ステータスを返す）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(500))
    const res = await postIngestBatch([ev()], {
      url: 'http://ingest',
      secret: SECRET,
      fetchImpl,
      maxRetries: 2,
      sleep: vi.fn().mockResolvedValue(undefined),
      backoffMs: () => 1,
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(500)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 初回 + 2 再送
  })

  it('再送のたびに timestamp/署名を作り直す（スキュー切れを防ぐ）', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse(500)).mockResolvedValueOnce(okResponse(200))
    let t = 1_770_000_000_000
    await postIngestBatch([ev()], {
      url: 'http://ingest',
      secret: SECRET,
      fetchImpl,
      now: () => (t += 60_000), // 呼ぶたび +60s
      sleep: vi.fn().mockResolvedValue(undefined),
      backoffMs: () => 1,
    })
    const ts1 = fetchImpl.mock.calls[0][1].headers['x-ingest-timestamp']
    const ts2 = fetchImpl.mock.calls[1][1].headers['x-ingest-timestamp']
    expect(ts1).not.toBe(ts2)
  })
})

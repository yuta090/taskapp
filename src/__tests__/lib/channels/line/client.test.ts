import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pushLineMessage, fetchLineMessageContent, LinePushError } from '@/lib/channels/line/client'

/**
 * LINE Messaging API push 送信クライアント
 * https://developers.line.biz/ja/reference/messaging-api/#send-push-message
 *
 * - POST https://api.line.me/v2/bot/message/push
 * - Authorization: Bearer <channel access token>
 * - retryKey による冪等送信（再試行時の二重配信防止）
 * - 非2xxは LinePushError（status と本文を保持）
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function okResponse() {
  return new Response(JSON.stringify({ sentMessages: [{ id: '1', quoteToken: 'q' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('pushLineMessage', () => {
  it('push APIへ正しいヘッダ・本文でPOSTする', async () => {
    fetchMock.mockResolvedValueOnce(okResponse())

    await pushLineMessage({
      accessToken: 'token-123',
      to: 'U0000000000000000000000000000000',
      messages: [{ type: 'text', text: 'こんにちは' }],
      retryKey: '123e4567-e89b-42d3-a456-426614174000',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/message/push')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer token-123')
    expect(headers['X-Line-Retry-Key']).toBe('123e4567-e89b-42d3-a456-426614174000')
    const body = JSON.parse(init.body as string)
    expect(body.to).toBe('U0000000000000000000000000000000')
    expect(body.messages).toEqual([{ type: 'text', text: 'こんにちは' }])
  })

  it('非2xxなら LinePushError を投げ status を保持する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid user id' }), { status: 400 }),
    )

    await expect(
      pushLineMessage({
        accessToken: 'token-123',
        to: 'bad-user',
        messages: [{ type: 'text', text: 'x' }],
      }),
    ).rejects.toMatchObject({ name: 'LinePushError', status: 400 })
  })

  it('retryKey 未指定でもヘッダ無しで送信できる', async () => {
    fetchMock.mockResolvedValueOnce(okResponse())

    await pushLineMessage({
      accessToken: 'token-123',
      to: 'U0',
      messages: [{ type: 'text', text: 'x' }],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Line-Retry-Key']).toBeUndefined()
  })

  it('LinePushError は Error のサブクラス', () => {
    const err = new LinePushError(429, 'rate limited')
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(429)
  })
})

describe('fetchLineMessageContent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  it('api-data ドメインの content エンドポイントから取得する', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    )

    const result = await fetchLineMessageContent('token-123', 'msg-100')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api-data.line.me/v2/bot/message/msg-100/content')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123')
    expect(result.contentType).toBe('image/jpeg')
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('非2xx（期限切れ等）は LinePushError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    await expect(fetchLineMessageContent('token-123', 'msg-gone')).rejects.toMatchObject({
      name: 'LinePushError',
      status: 404,
    })
  })
})

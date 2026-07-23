import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  pushLineMessage,
  fetchLineMessageContent,
  replyLineMessage,
  leaveRoom,
  fetchGroupMemberProfile,
  fetchGroupSummary,
  fetchBotInfo,
  fetchLineUserProfile,
  LinePushError,
} from '@/lib/channels/line/client'

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

describe('replyLineMessage', () => {
  it('reply APIへ replyToken と messages をPOSTする（通数無料のため消し込み確認等で使う）', async () => {
    fetchMock.mockResolvedValueOnce(okResponse())

    await replyLineMessage({
      accessToken: 'token-123',
      replyToken: 'reply-abc',
      messages: [{ type: 'text', text: '『酒屋へ発注』を完了にしました' }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/message/reply')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer token-123')
    const body = JSON.parse(init.body as string)
    expect(body.replyToken).toBe('reply-abc')
    expect(body.messages).toEqual([{ type: 'text', text: '『酒屋へ発注』を完了にしました' }])
  })

  it('非2xxなら LinePushError を投げる', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Invalid reply token', { status: 400 }))
    await expect(
      replyLineMessage({ accessToken: 't', replyToken: 'bad', messages: [{ type: 'text', text: 'x' }] }),
    ).rejects.toMatchObject({ name: 'LinePushError', status: 400 })
  })
})

describe('leaveRoom', () => {
  it('room leave APIへ roomId 付きでPOSTする（room招待の非サポート案内後に退出するため）', async () => {
    fetchMock.mockResolvedValueOnce(okResponse())

    await leaveRoom('token-123', 'R1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/room/R1/leave')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123')
  })

  it('非2xxなら LinePushError を投げる', async () => {
    fetchMock.mockResolvedValueOnce(new Response('error', { status: 500 }))
    await expect(leaveRoom('token-123', 'R1')).rejects.toMatchObject({
      name: 'LinePushError',
      status: 500,
    })
  })
})

describe('fetchGroupMemberProfile（Stage 2.5 §3-1: 完了の記名化）', () => {
  it('group member profile エンドポイントから displayName を取得する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ displayName: '田中太郎', userId: 'U-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchGroupMemberProfile('token-123', 'G-1', 'U-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/group/G-1/member/U-1/profile')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123')
    expect(result).toEqual({ displayName: '田中太郎' })
  })

  it('ベストエフォート: 非2xxは例外を投げず null を返す（完了処理は止めない）', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    const result = await fetchGroupMemberProfile('token-123', 'G-1', 'U-unknown')
    expect(result).toBeNull()
  })

  it('ベストエフォート: fetch自体が例外を投げても null を返す', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const result = await fetchGroupMemberProfile('token-123', 'G-1', 'U-1')
    expect(result).toBeNull()
  })
})

describe('fetchGroupSummary（Stage 4: 共有bot紐付けclaimの承認者向け照合材料）', () => {
  it('group summary エンドポイントから groupName を取得する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ groupId: 'G-1', groupName: 'ある会社の相談グループ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchGroupSummary('token-123', 'G-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/group/G-1/summary')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123')
    expect(result).toEqual({ groupName: 'ある会社の相談グループ' })
  })

  it('ベストエフォート: 非2xxは例外を投げず null を返す（claim登録自体は止めない）', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    const result = await fetchGroupSummary('token-123', 'G-unknown')
    expect(result).toBeNull()
  })

  it('ベストエフォート: fetch自体が例外を投げても null を返す', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const result = await fetchGroupSummary('token-123', 'G-1')
    expect(result).toBeNull()
  })
})

describe('fetchBotInfo（LINE友だち追加QR導線: basic_id取得用）', () => {
  it('bot info エンドポイントから basicId を取得する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'U-bot-1', basicId: '@abc1234', displayName: '秘書' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchBotInfo('token-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/info')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123')
    expect(result).toEqual({ basicId: '@abc1234' })
  })

  it('ベストエフォート: 非2xxは例外を投げず null を返す', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    const result = await fetchBotInfo('bad-token')
    expect(result).toBeNull()
  })

  it('ベストエフォート: JSONが不正なら null を返す', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const result = await fetchBotInfo('token-123')
    expect(result).toBeNull()
  })

  it('ベストエフォート: basicId が欠落していれば null を返す', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'U-bot-1', displayName: '秘書' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await fetchBotInfo('token-123')
    expect(result).toBeNull()
  })

  it('ベストエフォート: fetch自体が例外を投げても null を返す', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const result = await fetchBotInfo('token-123')
    expect(result).toBeNull()
  })
})

describe('fetchLineUserProfile（DM到達不能の日次照合ジョブ専用）', () => {
  it('200 → reachable（1:1 profile エンドポイントをBearer認証で叩く）', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ displayName: '田中太郎', userId: 'U-1' }), { status: 200 }),
    )

    const result = await fetchLineUserProfile('token-123', 'U-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/profile/U-1')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123')
    expect(result).toBe('reachable')
  })

  it('404 → unreachable（ブロック済み/未フォロー）', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    const result = await fetchLineUserProfile('token-123', 'U-blocked')
    expect(result).toBe('unreachable')
  })

  it('429 → error（判定保留・レート制限）', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }))
    const result = await fetchLineUserProfile('token-123', 'U-1')
    expect(result).toBe('error')
  })

  it('500 → error（判定保留）', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
    const result = await fetchLineUserProfile('token-123', 'U-1')
    expect(result).toBe('error')
  })

  it('ネットワーク例外 → error（判定保留）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const result = await fetchLineUserProfile('token-123', 'U-1')
    expect(result).toBe('error')
  })
})

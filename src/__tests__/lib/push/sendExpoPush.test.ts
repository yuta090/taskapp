import { describe, it, expect, vi } from 'vitest'
import { buildExpoMessage, sendExpoPush, EXPO_PUSH_URL } from '@/lib/push/sendExpoPush'

const notification = {
  id: 'n1',
  org_id: 'o1',
  space_id: 's1',
  type: 'ball_passed',
  payload: { task_id: 't1', message: '「ロゴ案」のボールが渡されました' },
}
const message = { title: 'ボールがあなたに渡されました', body: '「ロゴ案」のボールが渡されました', url: '/x', tag: 'taskapp-n1' }

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('buildExpoMessage', () => {
  it('見出し・本文と、アプリがタスクを開くための情報を載せる', () => {
    expect(buildExpoMessage('ExponentPushToken[a]', notification, message)).toEqual({
      to: 'ExponentPushToken[a]',
      title: 'ボールがあなたに渡されました',
      body: '「ロゴ案」のボールが渡されました',
      sound: 'default',
      priority: 'default',
      channelId: 'default',
      data: { notificationId: 'n1', taskId: 't1', type: 'ball_passed' },
    })
  })
  it('至急の確認依頼は優先度を上げる（静かな時間帯の例外と同じ種類）', () => {
    expect(buildExpoMessage('ExponentPushToken[a]', { ...notification, type: 'urgent_confirmation' }, message).priority).toBe('high')
  })
  it('タスクに結びつかない通知は taskId が null', () => {
    expect(buildExpoMessage('ExponentPushToken[a]', { ...notification, payload: {} }, message).data.taskId).toBeNull()
  })
})

describe('sendExpoPush', () => {
  const tokens = [
    { id: 'r1', token: 'ExponentPushToken[a]' },
    { id: 'r2', token: 'ExponentPushToken[b]' },
  ]

  it('Expo に送り、成功した行と、端末から消えた行を分けて返す', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      ])
    )
    const result = await sendExpoPush(tokens, notification, message, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(EXPO_PUSH_URL)
    expect(JSON.parse(init.body as string)).toHaveLength(2)
    expect(result).toEqual({ sent: 1, failed: 1, usedIds: ['r1'], staleIds: ['r2'] })
  })

  it('アクセストークンがあれば付ける（無ければ付けない）', async () => {
    const fetchImpl = vi.fn(async () => okResponse([{ status: 'ok' }, { status: 'ok' }]))
    await sendExpoPush(tokens, notification, message, { fetchImpl, accessToken: 'secret' })
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret')

    fetchImpl.mockClear()
    await sendExpoPush(tokens, notification, message, { fetchImpl })
    const plain = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(plain.Authorization).toBeUndefined()
  })

  it('Expo が落ちていたら全部失敗にし、行は消さない（端末はまだ生きているかもしれない）', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad gateway', { status: 502 }))
    expect(await sendExpoPush(tokens, notification, message, { fetchImpl })).toEqual({
      sent: 0,
      failed: 2,
      usedIds: [],
      staleIds: [],
    })
  })

  it('通信エラー・時間切れでも投げずに失敗として返す（Web Push の送信を巻き込まない）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('timeout')
    })
    expect((await sendExpoPush(tokens, notification, message, { fetchImpl })).failed).toBe(2)
  })

  it('100件ごとに分けて送る（Expo の1回の上限）', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `r${i}`, token: `ExponentPushToken[${i}]` }))
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const count = (JSON.parse(init?.body as string) as unknown[]).length
      return okResponse(Array.from({ length: count }, () => ({ status: 'ok' })))
    })
    const result = await sendExpoPush(many, notification, message, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(150)
  })

  it('宛先が無ければ送らない', async () => {
    const fetchImpl = vi.fn()
    expect(await sendExpoPush([], notification, message, { fetchImpl })).toEqual({
      sent: 0,
      failed: 0,
      usedIds: [],
      staleIds: [],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

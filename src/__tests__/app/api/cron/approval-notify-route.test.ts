import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/approval-notify — pending承認候補の1:1確認Flexディスパッチャ（Stage 2.7-B §4-4）
 *
 * - Bearer CRON_SECRET 必須
 * - claim RPC で掴んだ候補を、責任者の external_user_id へ 1:1 push
 * - account の token は一意化して復号（同一OAに複数候補が集まる）
 * - 1件の失敗が他を止めない
 */

const storeMock = {
  claimPendingApprovalNotifications: vi.fn(),
  findLineAccountById: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const pushMock = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...args: unknown[]) => pushMock(...args),
}))

const { POST } = await import('@/app/api/cron/approval-notify/route')

function callPost(headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL('/api/cron/approval-notify', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
  return POST(request)
}

const ACCOUNT = {
  id: 'acc-1',
  orgId: 'org-1',
  displayName: '山田会計',
  channelSecret: 's',
  accessToken: 'token-1',
  status: 'active' as const,
}

const AUTH = { authorization: 'Bearer test-cron-secret' }

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    taskId: '11111111-1111-4111-8111-111111111111',
    orgId: 'org-1',
    channelAccountId: 'acc-1',
    externalUserId: 'Uapprover',
    title: '酒屋へ発注',
    dueDate: '2026-07-17',
    dueTime: null,
    ...over,
  }
}

describe('POST /api/cron/approval-notify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    storeMock.claimPendingApprovalNotifications.mockResolvedValue([])
    storeMock.findLineAccountById.mockResolvedValue(ACCOUNT)
    pushMock.mockResolvedValue(undefined)
  })

  it('CRON_SECRET が違えば 401（claim もしない）', async () => {
    const res = await callPost({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
    expect(storeMock.claimPendingApprovalNotifications).not.toHaveBeenCalled()
  })

  it('claim した候補を責任者の1:1へ承認Flexとして push する', async () => {
    storeMock.claimPendingApprovalNotifications.mockResolvedValue([row()])
    const res = await callPost(AUTH)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ claimed: 1, sent: 1, errors: [] })
    expect(pushMock).toHaveBeenCalledTimes(1)
    const arg = pushMock.mock.calls[0][0] as { accessToken: string; to: string; messages: unknown[]; retryKey?: string }
    expect(arg.accessToken).toBe('token-1')
    expect(arg.to).toBe('Uapprover')
    const serialized = JSON.stringify(arg.messages[0])
    expect(serialized).toContain('酒屋へ発注')
    expect(serialized).toContain('action=digest_promote&task=11111111-1111-4111-8111-111111111111')
    expect(serialized).toContain('action=digest_reject&task=11111111-1111-4111-8111-111111111111')
    expect(arg.retryKey).toBeTruthy() // HTTPリトライで二重送信しない
  })

  it('同一アカウントの複数候補でも token 復号は1回だけ', async () => {
    storeMock.claimPendingApprovalNotifications.mockResolvedValue([
      row({ taskId: '11111111-1111-4111-8111-111111111111' }),
      row({ taskId: '22222222-2222-4222-8222-222222222222', externalUserId: 'Uapprover2' }),
    ])
    await callPost(AUTH)

    expect(storeMock.findLineAccountById).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('1件の push 失敗が他を止めない（errorsに記録し200）', async () => {
    storeMock.claimPendingApprovalNotifications.mockResolvedValue([
      row({ taskId: '11111111-1111-4111-8111-111111111111' }),
      row({ taskId: '22222222-2222-4222-8222-222222222222' }),
    ])
    pushMock.mockRejectedValueOnce(new Error('LINE 429'))
    const res = await callPost(AUTH)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.sent).toBe(1)
    expect(json.errors).toHaveLength(1)
  })

  it('account が解決できない候補は errors に記録し push しない', async () => {
    storeMock.claimPendingApprovalNotifications.mockResolvedValue([row()])
    storeMock.findLineAccountById.mockResolvedValue(null)
    const res = await callPost(AUTH)
    const json = await res.json()

    expect(pushMock).not.toHaveBeenCalled()
    expect(json.errors).toHaveLength(1)
    expect(json.sent).toBe(0)
  })

  it('account解決が reject しても全体を落とさず、当該行だけ errors・他accountは継続', async () => {
    storeMock.claimPendingApprovalNotifications.mockResolvedValue([
      row({ taskId: '11111111-1111-4111-8111-111111111111', channelAccountId: 'acc-bad' }),
      row({ taskId: '22222222-2222-4222-8222-222222222222', channelAccountId: 'acc-1' }),
    ])
    storeMock.findLineAccountById.mockImplementation((id: string) => {
      if (id === 'acc-bad') return Promise.reject(new Error('SYSTEM_ENCRYPTION_KEY missing'))
      return Promise.resolve(ACCOUNT)
    })
    const res = await callPost(AUTH)
    const json = await res.json()

    expect(res.status).toBe(200) // 500 で全滅させない
    expect(json.sent).toBe(1) // acc-1 の候補は送れる
    expect(json.errors).toHaveLength(1) // acc-bad の候補だけ errors
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('候補が無ければ何もしない', async () => {
    const res = await callPost(AUTH)
    const json = await res.json()
    expect(json).toMatchObject({ claimed: 0, sent: 0 })
    expect(pushMock).not.toHaveBeenCalled()
  })
})

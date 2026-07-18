import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/task-reminders — 時刻指定タスクリマインド（③・pro以上限定）
 *
 * - Bearer CRON_SECRET 必須
 * - remind_at 到来かつ未送信のタスクを、space に紐づくactiveなLINEグループへ push
 * - 送信時に org の timed_line_reminders エンタイトルメントを再確認（fail-closed）。
 *   未entitledは送らず remind_sent_at も付けない（アップグレードで後から届く）
 * - 送信成功したタスクだけ remind_sent_at を刻む（二重送信しない）
 */

const storeMock = {
  findDueTaskReminders: vi.fn(),
  findActiveGroupsForSpaces: vi.fn(),
  markTaskReminderSent: vi.fn(),
  findLineAccountById: vi.fn(),
}
vi.mock('@/lib/reminders/taskReminderStore', () => storeMock)

const accountMock = { findLineAccountById: storeMock.findLineAccountById }
vi.mock('@/lib/channels/store', () => accountMock)

const pushMock = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...args: unknown[]) => pushMock(...args),
}))

const resolveEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveEntitlementsMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}))

const { POST } = await import('@/app/api/cron/task-reminders/route')

function callPost(headers: Record<string, string> = { authorization: 'Bearer test-cron-secret' }) {
  const request = new NextRequest(new URL('/api/cron/task-reminders', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
  return POST(request)
}

const ACCOUNT = { id: 'acc-1', accessToken: 'token-1' }

function entitled(has: boolean) {
  return { planId: has ? 'pro' : 'free', has: () => has }
}

const DUE_TASK = {
  id: 'task-1',
  title: '見積書の送付',
  spaceId: 'space-1',
  dueDate: '2026-07-25',
  remindAt: '2020-01-01T00:00:00.000Z',
  remindSentAt: null,
  status: 'todo',
}

const GROUP_LINK = {
  spaceId: 'space-1',
  orgId: 'org-1',
  accountId: 'acc-1',
  externalGroupId: 'G-1',
  ownerType: 'platform',
}

describe('POST /api/cron/task-reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    storeMock.findDueTaskReminders.mockResolvedValue([DUE_TASK])
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([GROUP_LINK])
    storeMock.findLineAccountById.mockResolvedValue(ACCOUNT)
    storeMock.markTaskReminderSent.mockResolvedValue(undefined)
    resolveEntitlementsMock.mockResolvedValue(entitled(true))
    pushMock.mockResolvedValue(undefined)
  })

  it('CRON_SECRET が無ければ 401', async () => {
    const res = await callPost({})
    expect(res.status).toBe(401)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('entitled org: LINEグループへ push し remind_sent_at を刻む', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushArg = pushMock.mock.calls[0][0]
    expect(pushArg.to).toBe('G-1')
    expect(pushArg.accessToken).toBe('token-1')
    expect(JSON.stringify(pushArg.messages)).toContain('見積書の送付')
    expect(storeMock.markTaskReminderSent).toHaveBeenCalledWith('task-1', expect.any(String))
  })

  it('未entitled org: 送らず remind_sent_at も刻まない(fail-closed)', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled(false))
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
  })

  it('未到来リマインド(remind_at 未来)は送らない', async () => {
    storeMock.findDueTaskReminders.mockResolvedValue([
      { ...DUE_TASK, remindAt: '2999-01-01T00:00:00.000Z' },
    ])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('紐付くグループが無ければ送らず sent も刻まない', async () => {
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
  })

  it('同一spaceにplatformとorgが紐付く場合、共有Bot(platform)だけへ配信する', async () => {
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([
      { spaceId: 'space-1', orgId: 'org-1', accountId: 'acc-org', externalGroupId: 'G-ORG', ownerType: 'org' },
      GROUP_LINK, // platform / G-1
    ])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0][0].to).toBe('G-1')
    expect(storeMock.findLineAccountById).toHaveBeenCalledWith('acc-1')
    expect(storeMock.findLineAccountById).not.toHaveBeenCalledWith('acc-org')
  })

  it('platformが無ければ org へフォールバックして配信する', async () => {
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([
      { spaceId: 'space-1', orgId: 'org-1', accountId: 'acc-org', externalGroupId: 'G-ORG', ownerType: 'org' },
    ])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0][0].to).toBe('G-ORG')
  })

  it('push が失敗したら sent を刻まない(次回再送)', async () => {
    pushMock.mockRejectedValue(new Error('LINE 500'))
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
  })

  it('dryRun は送信も記録もしない', async () => {
    const request = new NextRequest(
      new URL('/api/cron/task-reminders?dryRun=true', 'http://localhost:3000'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-cron-secret' },
        body: JSON.stringify({}),
      },
    )
    const res = await POST(request)
    const json = await res.json()
    expect(pushMock).not.toHaveBeenCalled()
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
    expect(json.dryRun).toBe(true)
  })
})

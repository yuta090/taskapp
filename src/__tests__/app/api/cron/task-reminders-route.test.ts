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
 * - 送信は統一送信境界 sendSecretaryPush 経由（PR-0.5・課金穴是正）。二層予算で
 *   抑止されたタスクは remind_sent_at を刻まない（次回cronで再送）
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

const sendSecretaryPushMock = vi.fn()
vi.mock('@/lib/channels/send/secretaryPush', () => ({
  sendSecretaryPush: (...args: unknown[]) => sendSecretaryPushMock(...args),
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

const ACCOUNT = { id: 'acc-1', ownerType: 'platform' as const, accessToken: 'token-1' }

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
  id: 'group-1',
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
    sendSecretaryPushMock.mockResolvedValue({ delivered: true })
  })

  it('CRON_SECRET が無ければ 401', async () => {
    const res = await callPost({})
    expect(res.status).toBe(401)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
  })

  it('entitled org: 統一送信境界(sendSecretaryPush)経由で push し remind_sent_at を刻む', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    const arg = sendSecretaryPushMock.mock.calls[0][0]
    expect(arg.to).toBe('G-1')
    expect(arg.account).toMatchObject({ id: 'acc-1', accessToken: 'token-1' })
    expect(arg.orgId).toBe('org-1')
    expect(JSON.stringify(arg.messages)).toContain('見積書の送付')
    expect(typeof arg.jstDayOfYear).toBe('number')
    expect(arg.record).toMatchObject({ spaceId: 'space-1', groupId: 'group-1', body: '見積書の送付' })
    expect(storeMock.markTaskReminderSent).toHaveBeenCalledWith('task-1', expect.any(String))
  })

  it('未entitled org: 送らず remind_sent_at も刻まない(fail-closed)', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled(false))
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
  })

  it('未到来リマインド(remind_at 未来)は送らない', async () => {
    storeMock.findDueTaskReminders.mockResolvedValue([
      { ...DUE_TASK, remindAt: '2999-01-01T00:00:00.000Z' },
    ])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
  })

  it('紐付くグループが無ければ送らず sent も刻まない', async () => {
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
  })

  it('同一spaceにplatformとorgが紐付く場合、共有Bot(platform)だけへ配信する', async () => {
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([
      { id: 'group-org', spaceId: 'space-1', orgId: 'org-1', accountId: 'acc-org', externalGroupId: 'G-ORG', ownerType: 'org' },
      GROUP_LINK, // platform / G-1
    ])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('G-1')
    expect(storeMock.findLineAccountById).toHaveBeenCalledWith('acc-1')
    expect(storeMock.findLineAccountById).not.toHaveBeenCalledWith('acc-org')
  })

  it('platformが無ければ org へフォールバックして配信する', async () => {
    storeMock.findActiveGroupsForSpaces.mockResolvedValue([
      { id: 'group-org', spaceId: 'space-1', orgId: 'org-1', accountId: 'acc-org', externalGroupId: 'G-ORG', ownerType: 'org' },
    ])
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('G-ORG')
  })

  it('push が失敗したら sent を刻まない(次回再送)', async () => {
    sendSecretaryPushMock.mockRejectedValue(new Error('LINE 500'))
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
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
    expect(json.dryRun).toBe(true)
  })

  describe('統一送信境界の二層予算（PR-0.5・課金穴是正）', () => {
    it('sendSecretaryPushが予算抑止(delivered:false)を返したら remind_sent_at を刻まず skipped に理由を積む(次回再送可能)', async () => {
      sendSecretaryPushMock.mockResolvedValue({ delivered: false, reason: 'global_budget_hard_suppress' })
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(storeMock.markTaskReminderSent).not.toHaveBeenCalled()
      expect(json.sent).toBe(0)
      expect(json.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ taskId: 'task-1', reason: 'global_budget_hard_suppress' }),
        ]),
      )
    })

    it('配信成功時は sendSecretaryPush（billable_push計上を担う統一境界）経由でのみ送信し、remind_sent_at を刻む', async () => {
      sendSecretaryPushMock.mockResolvedValue({ delivered: true })
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
      expect(storeMock.markTaskReminderSent).toHaveBeenCalledWith('task-1', expect.any(String))
    })
  })

  describe('同一spaceに複数activeグループ（HIGH修正回帰: 宛先込みretryKey）', () => {
    const GROUP_LINK_2 = {
      id: 'group-2',
      spaceId: 'space-1',
      orgId: 'org-1',
      accountId: 'acc-1',
      externalGroupId: 'G-2',
      ownerType: 'platform',
    }

    it('2つのactiveグループへ配信するとき sendSecretaryPush が異なる retryKey で2回呼ばれる（LINE idempotencyでの取りこぼし防止）', async () => {
      storeMock.findActiveGroupsForSpaces.mockResolvedValue([GROUP_LINK, GROUP_LINK_2])
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).toHaveBeenCalledTimes(2)

      const calls = sendSecretaryPushMock.mock.calls.map((c) => c[0])
      const retryKeys = calls.map((c) => c.retryKey)
      expect(new Set(retryKeys).size).toBe(2) // 宛先ごとに一意（重複しない）

      const targets = calls.map((c) => c.to).sort()
      expect(targets).toEqual(['G-1', 'G-2'])

      // 決定性: 同一 (task, remindAt, group) は同一キーになる
      const callForG1 = calls.find((c) => c.to === 'G-1')
      const callForG2 = calls.find((c) => c.to === 'G-2')
      expect(callForG1!.retryKey).not.toBe(callForG2!.retryKey)

      expect(json.sent).toBe(1)
      expect(storeMock.markTaskReminderSent).toHaveBeenCalledWith('task-1', expect.any(String))
    })

    it('片方のグループでLINE idempotency起因のpush失敗があっても、もう片方は配信されskippedに記録される', async () => {
      storeMock.findActiveGroupsForSpaces.mockResolvedValue([GROUP_LINK, GROUP_LINK_2])
      sendSecretaryPushMock.mockImplementation(async (arg: { to: string }) => {
        if (arg.to === 'G-2') throw new Error('LINE 409 (retry key conflict)')
        return { delivered: true }
      })

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1) // G-1成功でsentは刻まれる
      expect(json.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ taskId: 'task-1', reason: expect.stringContaining('push_failed') }),
        ]),
      )
    })
  })
})

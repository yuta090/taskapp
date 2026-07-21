import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/due-reminder-sender（設計正本 §6/§6.1/§9・PR-1）
 *
 * - Bearer CRON_SECRET 必須
 * - claim → §6 3条件staleness再確認 → entitlement再確認(timed_line_reminders) →
 *   宛先解決(§A 3段: DM→発生元グループ→spaceグループ→no_route) → 統一送信境界で送信 → finalize
 */

const storeMock = {
  claimDueReminderOccurrences: vi.fn(),
  finalizeDueReminderOccurrence: vi.fn(),
  findTaskSnapshotForReminder: vi.fn(),
  findOrgIdForSpace: vi.fn(),
  findConnectionFreshness: vi.fn(),
}
vi.mock('@/lib/reminders/dueReminderStore', () => storeMock)

const channelsStoreMock = {
  findActiveUserLinkForUser: vi.fn(),
  findChatOriginGroupForTask: vi.fn(),
  findGroupById: vi.fn(),
  findActiveGroupForSpace: vi.fn(),
  findLineAccountByIdLookup: vi.fn(),
}
vi.mock('@/lib/channels/store', () => channelsStoreMock)

const resolveEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveEntitlementsMock(...args),
}))

const sendSecretaryPushMock = vi.fn()
vi.mock('@/lib/channels/send/secretaryPush', () => ({
  sendSecretaryPush: (...args: unknown[]) => sendSecretaryPushMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}))

const { POST } = await import('@/app/api/cron/due-reminder-sender/route')

function callPost(headers: Record<string, string> = { authorization: 'Bearer test-cron-secret' }) {
  const request = new NextRequest(new URL('/api/cron/due-reminder-sender', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
  return POST(request)
}

function entitled(hasMap: Record<string, boolean>) {
  return { planId: 'pro', has: (f: string) => hasMap[f] ?? false }
}

const OCC = {
  id: 'occ-1',
  taskId: 'task-1',
  kind: 'due_today' as const,
  offsetMinutes: 0,
  dueSnapshot: '2026-07-25',
  sendCount: 0,
}

const TASK_SNAPSHOT = {
  id: 'task-1',
  title: '見積書の送付',
  status: 'todo',
  dueDate: '2026-07-25',
  assigneeId: 'user-1',
  ball: 'internal' as const,
  spaceId: 'space-1',
  dueAuthorityConnectionId: null as string | null,
}

const ACCOUNT = { id: 'acc-1', ownerType: 'org' as const, accessToken: 'token-1' }
const ACCOUNT_LOOKUP = { id: 'acc-1', status: 'active' as const, account: ACCOUNT }

const SPACE_GROUP = {
  id: 'group-space',
  orgId: 'org-1',
  spaceId: 'space-1',
  accountId: 'acc-1',
  externalGroupId: 'G-SPACE',
  status: 'active' as const,
}

describe('POST /api/cron/due-reminder-sender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'

    storeMock.claimDueReminderOccurrences.mockResolvedValue([OCC])
    storeMock.finalizeDueReminderOccurrence.mockResolvedValue(undefined)
    storeMock.findTaskSnapshotForReminder.mockResolvedValue(TASK_SNAPSHOT)
    storeMock.findOrgIdForSpace.mockResolvedValue('org-1')
    storeMock.findConnectionFreshness.mockResolvedValue(null)

    resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: true }))

    channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)
    channelsStoreMock.findChatOriginGroupForTask.mockResolvedValue(null)
    channelsStoreMock.findGroupById.mockResolvedValue(null)
    channelsStoreMock.findActiveGroupForSpace.mockResolvedValue(SPACE_GROUP)
    channelsStoreMock.findLineAccountByIdLookup.mockResolvedValue(ACCOUNT_LOOKUP)

    sendSecretaryPushMock.mockResolvedValue({ delivered: true })
  })

  it('CRON_SECRET未設定は500', async () => {
    delete process.env.CRON_SECRET
    const res = await callPost({ authorization: 'Bearer anything' })
    expect(res.status).toBe(500)
  })

  it('Authorizationヘッダ不正は401', async () => {
    const res = await callPost({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
    expect(storeMock.claimDueReminderOccurrences).not.toHaveBeenCalled()
  })

  it('宛先皆無(DM無・発生元無・spaceグループ無)ならsuppressed(no_route)', async () => {
    channelsStoreMock.findActiveGroupForSpace.mockResolvedValue(null)
    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'suppressed', 'no_route')
    expect(json.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ occurrenceId: 'occ-1', reason: 'no_route' })]),
    )
  })

  it('発生元グループが無ければspaceのactiveグループへ配信する', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('G-SPACE')
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'sent')
  })

  it('発生元チャットグループがあれば優先する', async () => {
    channelsStoreMock.findChatOriginGroupForTask.mockResolvedValue({ groupId: 'group-origin', orgId: 'org-1' })
    channelsStoreMock.findGroupById.mockResolvedValue({
      id: 'group-origin',
      orgId: 'org-1',
      spaceId: 'space-1',
      accountId: 'acc-1',
      externalGroupId: 'G-ORIGIN',
      status: 'active',
    })

    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('G-ORIGIN')
    // spaceグループへは問い合わせない(発生元が優先されるため呼ばれても使われない可能性はあるが、
    // 現実装ではorigin成立時はspace解決を呼ばない)
    expect(channelsStoreMock.findActiveGroupForSpace).not.toHaveBeenCalled()
  })

  it('Pro＋line_direct_dm＋active user linkがあれば1:1 DMへ配信する（宛先込みretryKey）', async () => {
    channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue({
      channelAccountId: 'acc-1',
      externalUserId: 'U-DM-1',
    })

    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    const arg = sendSecretaryPushMock.mock.calls[0][0]
    expect(arg.to).toBe('U-DM-1')
    expect(arg.record).toMatchObject({ groupId: null, externalUserId: 'U-DM-1' })
    expect(arg.retryKey).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
  })

  it('DM宛てとグループ宛てで異なるretryKeyになる（宛先込みretryKey・HIGH修正回帰）', async () => {
    channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue({
      channelAccountId: 'acc-1',
      externalUserId: 'U-DM-1',
    })
    const dmResult = await callPost()
    expect(dmResult.status).toBe(200)
    const dmRetryKey = sendSecretaryPushMock.mock.calls[0][0].retryKey

    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    storeMock.claimDueReminderOccurrences.mockResolvedValue([OCC])
    storeMock.findTaskSnapshotForReminder.mockResolvedValue(TASK_SNAPSHOT)
    storeMock.findOrgIdForSpace.mockResolvedValue('org-1')
    storeMock.findConnectionFreshness.mockResolvedValue(null)
    resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: true }))
    channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)
    channelsStoreMock.findChatOriginGroupForTask.mockResolvedValue(null)
    channelsStoreMock.findActiveGroupForSpace.mockResolvedValue(SPACE_GROUP)
    channelsStoreMock.findLineAccountByIdLookup.mockResolvedValue(ACCOUNT_LOOKUP)
    sendSecretaryPushMock.mockResolvedValue({ delivered: true })

    await callPost()
    const groupRetryKey = sendSecretaryPushMock.mock.calls[0][0].retryKey

    expect(dmRetryKey).not.toBe(groupRetryKey)
  })

  it('Freeなど未entitled(timed_line_reminders無し)は送らずsuppressed(not_entitled)', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: false }))
    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'suppressed', 'not_entitled')
    expect(json.sent).toBe(0)
  })

  it('line_direct_dm を持たなければDMを試さずグループへ配信する', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: false }))
    channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue({
      channelAccountId: 'acc-1',
      externalUserId: 'U-DM-1',
    })

    const res = await callPost()
    expect(res.status).toBe(200)
    expect(channelsStoreMock.findActiveUserLinkForUser).not.toHaveBeenCalled()
    expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('G-SPACE')
  })

  describe('staleness(§6 3条件)', () => {
    it('status=doneはsuppressed(done)', async () => {
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({ ...TASK_SNAPSHOT, status: 'done' })
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).not.toHaveBeenCalled()
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'suppressed', 'done')
    })

    it('再読取りdue_dateがdue_snapshotと不一致はsuppressed(due_changed)', async () => {
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({ ...TASK_SNAPSHOT, dueDate: '2026-08-01' })
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).not.toHaveBeenCalled()
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'suppressed',
        'due_changed',
      )
    })

    it('external権威で接続がSLA超過ならsuppressed(stale_external_due)', async () => {
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({
        ...TASK_SNAPSHOT,
        dueAuthorityConnectionId: 'conn-1',
      })
      storeMock.findConnectionFreshness.mockResolvedValue({
        status: 'active',
        provider: 'google_tasks',
        lastImportSuccessAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).not.toHaveBeenCalled()
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'suppressed',
        'stale_external_due',
      )
    })

    it('タスクが見つからなければsuppressed(task_not_found)', async () => {
      storeMock.findTaskSnapshotForReminder.mockResolvedValue(null)
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'suppressed',
        'task_not_found',
      )
    })
  })

  describe('ball×文面（宛先は変えない）', () => {
    it('ball=clientとinternalで文面が異なるが宛先(to)は同一', async () => {
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({ ...TASK_SNAPSHOT, ball: 'client' })
      await callPost()
      const clientText = sendSecretaryPushMock.mock.calls[0][0].messages[0].altText
      const clientTo = sendSecretaryPushMock.mock.calls[0][0].to

      vi.clearAllMocks()
      process.env.CRON_SECRET = 'test-cron-secret'
      storeMock.claimDueReminderOccurrences.mockResolvedValue([OCC])
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({ ...TASK_SNAPSHOT, ball: 'internal' })
      storeMock.findOrgIdForSpace.mockResolvedValue('org-1')
      storeMock.findConnectionFreshness.mockResolvedValue(null)
      resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: true }))
      channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)
      channelsStoreMock.findChatOriginGroupForTask.mockResolvedValue(null)
      channelsStoreMock.findActiveGroupForSpace.mockResolvedValue(SPACE_GROUP)
      channelsStoreMock.findLineAccountByIdLookup.mockResolvedValue(ACCOUNT_LOOKUP)
      sendSecretaryPushMock.mockResolvedValue({ delivered: true })

      await callPost()
      const internalText = sendSecretaryPushMock.mock.calls[0][0].messages[0].altText
      const internalTo = sendSecretaryPushMock.mock.calls[0][0].to

      expect(clientText).not.toBe(internalText)
      expect(clientTo).toBe(internalTo)
    })
  })

  describe('確認Flex送信（設計正本 §7・PR-2）', () => {
    it('text単体ではなくFlex（[完了した][まだ][○日後に再通知]ボタン付き）で送信する', async () => {
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)

      const message = sendSecretaryPushMock.mock.calls[0][0].messages[0]
      expect(message.type).toBe('flex')
      expect(typeof message.altText).toBe('string')
      expect(message.altText.length).toBeGreaterThan(0)

      const buttons = message.contents.footer.contents as Array<{ action: { label: string; data: string } }>
      const labels = buttons.map((b) => b.action.label)
      expect(labels).toEqual(['完了した', 'まだ', '1日後に再通知'])
      expect(buttons[0].action.data).toBe(`action=due_reminder_done&task=${OCC.taskId}`)
      expect(buttons[1].action.data).toBe(
        `action=due_reminder_snooze&occurrence=${OCC.id}&days=1&gen=${OCC.sendCount}`,
      )

      // audit/record.body には従来のtext本文相当(altText)を残す
      expect(sendSecretaryPushMock.mock.calls[0][0].record.body).toBe(message.altText)
    })

    it('claimしたoccurrenceのsend_count(世代)がsnooze postbackのgenに渡る（code review #2是正・リプレイ防止）', async () => {
      storeMock.claimDueReminderOccurrences.mockResolvedValue([{ ...OCC, sendCount: 3 }])

      const res = await callPost()
      expect(res.status).toBe(200)

      const message = sendSecretaryPushMock.mock.calls[0][0].messages[0]
      const buttons = message.contents.footer.contents as Array<{ action: { data: string } }>
      expect(buttons[1].action.data).toBe(`action=due_reminder_snooze&occurrence=${OCC.id}&days=1&gen=3`)
      expect(buttons[2].action.data).toBe(`action=due_reminder_snooze&occurrence=${OCC.id}&days=1&gen=3`)
    })
  })

  describe('統一送信境界の結果に応じたfinalize', () => {
    it('予算抑止(delivered:false)はdeferred(翌窓再送)にする', async () => {
      sendSecretaryPushMock.mockResolvedValue({ delivered: false, reason: 'global_budget_hard_suppress' })
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'deferred',
        'global_budget_hard_suppress',
      )
      expect(json.sent).toBe(0)
    })

    it('push失敗(例外)はfinalizeしない(lease失効による自然な再送に委ねる)', async () => {
      sendSecretaryPushMock.mockRejectedValue(new Error('LINE 500'))
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).not.toHaveBeenCalled()
      expect(json.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ occurrenceId: 'occ-1', reason: expect.stringContaining('push_failed') }),
        ]),
      )
    })

    it('配信成功はsentにしclaimed/sentを集計する', async () => {
      const res = await callPost()
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.claimed).toBe(1)
      expect(json.sent).toBe(1)
    })
  })

  it('複数occurrenceを独立して処理する', async () => {
    storeMock.claimDueReminderOccurrences.mockResolvedValue([
      OCC,
      { ...OCC, id: 'occ-2', taskId: 'task-2' },
    ])
    storeMock.findTaskSnapshotForReminder.mockImplementation(async (taskId: string) =>
      taskId === 'task-2' ? { ...TASK_SNAPSHOT, id: 'task-2', status: 'done' } : TASK_SNAPSHOT,
    )

    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.sent).toBe(1)
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'sent')
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-2', 'suppressed', 'done')
  })

  describe('エラー分離（code review #2(a)是正: 1件の想定外例外が他occurrenceを巻き込まない）', () => {
    it('前段(findTaskSnapshotForReminder等)がthrowしても他のoccurrenceは配信される', async () => {
      storeMock.claimDueReminderOccurrences.mockResolvedValue([
        OCC,
        { ...OCC, id: 'occ-2', taskId: 'task-2' },
      ])
      storeMock.findTaskSnapshotForReminder.mockImplementation(async (taskId: string) => {
        if (taskId === 'task-1') throw new Error('db down')
        return { ...TASK_SNAPSHOT, id: 'task-2' }
      })

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      const finalizedOcc1 = storeMock.finalizeDueReminderOccurrence.mock.calls.some(
        (args: unknown[]) => args[0] === 'occ-1',
      )
      expect(finalizedOcc1).toBe(false)
      expect(json.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ occurrenceId: 'occ-1', reason: expect.stringContaining('unexpected_error') }),
        ]),
      )
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-2', 'sent')
    })

    it('findConnectionFreshnessがthrowしてもハンドラ全体は500にならず他occurrenceを処理し続ける', async () => {
      storeMock.claimDueReminderOccurrences.mockResolvedValue([
        OCC,
        { ...OCC, id: 'occ-2', taskId: 'task-2' },
      ])
      storeMock.findTaskSnapshotForReminder.mockImplementation(async (taskId: string) => ({
        ...TASK_SNAPSHOT,
        id: taskId,
        dueAuthorityConnectionId: taskId === 'task-1' ? 'conn-1' : null,
      }))
      storeMock.findConnectionFreshness.mockImplementation(async () => {
        throw new Error('connection lookup failed')
      })

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-2', 'sent')
    })
  })

  describe('push恒久/一時失敗の切り分け（code review #2(b)是正: 無限ループ防止）', () => {
    it('LINE 4xx(トークン失効等・429を除く)は恒久失敗としてsuppressed(push_failed_permanent)で終端する', async () => {
      const err = Object.assign(new Error('LINE push failed (401): invalid token'), { status: 401 })
      sendSecretaryPushMock.mockRejectedValue(err)

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'suppressed',
        'push_failed_permanent',
      )
      expect(json.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ occurrenceId: 'occ-1', reason: 'push_failed_permanent' }),
        ]),
      )
    })

    it('429(レート制限)は一時失敗としてfinalizeしない(lease失効での自然再試行に委ねる)', async () => {
      const err = Object.assign(new Error('LINE push failed (429): rate limited'), { status: 429 })
      sendSecretaryPushMock.mockRejectedValue(err)

      const res = await callPost()
      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).not.toHaveBeenCalled()
    })

    it('5xxは一時失敗としてfinalizeしない', async () => {
      const err = Object.assign(new Error('LINE push failed (500): server error'), { status: 500 })
      sendSecretaryPushMock.mockRejectedValue(err)

      const res = await callPost()
      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).not.toHaveBeenCalled()
    })

    it('statusを持たないネットワークエラー等は一時失敗としてfinalizeしない', async () => {
      sendSecretaryPushMock.mockRejectedValue(new TypeError('fetch failed'))

      const res = await callPost()
      expect(res.status).toBe(200)
      expect(storeMock.finalizeDueReminderOccurrence).not.toHaveBeenCalled()
    })
  })

  describe('retryKeyのUUID形状（code review #3是正: LINEのUUID厳格検証対策）', () => {
    it('version(4)/variant(8-b)ビットを持つUUID v4形状になる', async () => {
      await callPost()
      const retryKey = sendSecretaryPushMock.mock.calls[0][0].retryKey as string
      expect(retryKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    })

    it('決定的(同一入力→同一retryKey)', async () => {
      await callPost()
      const first = sendSecretaryPushMock.mock.calls[0][0].retryKey

      vi.clearAllMocks()
      process.env.CRON_SECRET = 'test-cron-secret'
      storeMock.claimDueReminderOccurrences.mockResolvedValue([OCC])
      storeMock.findTaskSnapshotForReminder.mockResolvedValue(TASK_SNAPSHOT)
      storeMock.findOrgIdForSpace.mockResolvedValue('org-1')
      storeMock.findConnectionFreshness.mockResolvedValue(null)
      resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: true }))
      channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)
      channelsStoreMock.findChatOriginGroupForTask.mockResolvedValue(null)
      channelsStoreMock.findActiveGroupForSpace.mockResolvedValue(SPACE_GROUP)
      channelsStoreMock.findLineAccountByIdLookup.mockResolvedValue(ACCOUNT_LOOKUP)
      sendSecretaryPushMock.mockResolvedValue({ delivered: true })

      await callPost()
      const second = sendSecretaryPushMock.mock.calls[0][0].retryKey

      expect(first).toBe(second)
    })

    it('宛先違いで異なるretryKeyになる(DM宛て vs グループ宛て・既存テストの再確認)', async () => {
      channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue({
        channelAccountId: 'acc-1',
        externalUserId: 'U-DM-1',
      })
      await callPost()
      const dmRetryKey = sendSecretaryPushMock.mock.calls[0][0].retryKey
      expect(dmRetryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })
  })
})

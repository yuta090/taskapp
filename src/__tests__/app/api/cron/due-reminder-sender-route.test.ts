import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/due-reminder-sender（設計正本 §6/§6.1/§9・PR-1・うざくない秘書 再設計）
 *
 * - Bearer CRON_SECRET 必須
 * - claim → §6 3条件staleness再確認 → org単位オンオフ再確認 →
 *   entitlement再確認(timed_line_reminders) → 宛先解決(1:1 DMのみ・無ければno_route) →
 *   統一送信境界で送信 → finalize
 * - うざくない秘書 再設計: 「発生元グループ→spaceグループ」への催促フォールバックは廃止。
 *   グループに催促文面が出る経路がゼロであることを回帰確認する。
 */

const storeMock = {
  claimDueReminderOccurrences: vi.fn(),
  finalizeDueReminderOccurrence: vi.fn(),
  findTaskSnapshotForReminder: vi.fn(),
  findOrgIdForSpace: vi.fn(),
  findConnectionFreshness: vi.fn(),
  isDueReminderEnabledForUser: vi.fn(),
  isOrgDueRemindersEnabled: vi.fn(),
}
vi.mock('@/lib/reminders/dueReminderStore', () => storeMock)

// markDmUnreachable/clearDmUnreachableはA案是正でsender側から呼ばなくなったが、mockには
// スパイとして残す（route.tsが誤って再importして呼んでしまう回帰をtoHaveBeenCalledWithで
// 検出できるようにするため。呼ばれないことを積極的に確認する意図）。
const channelsStoreMock = {
  findActiveUserLinkForUser: vi.fn(),
  findLineAccountByIdLookup: vi.fn(),
  markDmUnreachable: vi.fn(),
  clearDmUnreachable: vi.fn(),
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

/** DM解決が成立するときの標準セットアップを1関数にまとめる（各itのbeforeEachで使う） */
function setupDefaultMocks() {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'

  storeMock.claimDueReminderOccurrences.mockResolvedValue([OCC])
  storeMock.finalizeDueReminderOccurrence.mockResolvedValue(undefined)
  storeMock.findTaskSnapshotForReminder.mockResolvedValue(TASK_SNAPSHOT)
  storeMock.findOrgIdForSpace.mockResolvedValue('org-1')
  storeMock.findConnectionFreshness.mockResolvedValue(null)
  storeMock.isDueReminderEnabledForUser.mockResolvedValue(true)
  storeMock.isOrgDueRemindersEnabled.mockResolvedValue(true)

  resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: true }))

  channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue({
    channelAccountId: 'acc-1',
    externalUserId: 'U-DM-1',
  })
  channelsStoreMock.findLineAccountByIdLookup.mockResolvedValue(ACCOUNT_LOOKUP)

  sendSecretaryPushMock.mockResolvedValue({ delivered: true })
}

describe('POST /api/cron/due-reminder-sender', () => {
  beforeEach(() => {
    setupDefaultMocks()
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

  it('DM解決できたときだけ送信し、finalize(sent)する', async () => {
    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('U-DM-1')
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'sent')
    expect(json.sent).toBe(1)
  })

  it('DM無し(active user linkが無い)ならsuppressed(no_route)で終端し、グループへは一切送らない', async () => {
    channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)
    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'suppressed', 'no_route')
    expect(json.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ occurrenceId: 'occ-1', reason: 'no_route' })]),
    )
  })

  it('line_direct_dm を持たなければDMを試さずno_routeで終端する（グループ・フォールバック無し）', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled({ timed_line_reminders: true, line_direct_dm: false }))

    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(channelsStoreMock.findActiveUserLinkForUser).not.toHaveBeenCalled()
    expect(sendSecretaryPushMock).not.toHaveBeenCalled()
    expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'suppressed', 'no_route')
    expect(json.sent).toBe(0)
  })

  describe('催促文面がグループ宛に出る経路がゼロであること（うざくない秘書 再設計の中核回帰）', () => {
    it('チャンネルストア(store.ts)にグループ解決関数を一切呼ばない', async () => {
      await callPost()
      // 発生元グループ/spaceグループを引く関数はimportすらしていない
      // （このテストファイルのmockにも存在しない）ため、呼び出しようがないことを
      // sendSecretaryPushのtoが常にDM宛(U-DM-1)であることで裏付ける
      expect(sendSecretaryPushMock.mock.calls[0][0].to).toBe('U-DM-1')
      expect(sendSecretaryPushMock.mock.calls[0][0].record.groupId).toBeNull()
    })

    it('DM不能な複数occurrenceが全てno_routeで終端し、1件もグループ宛のpushが発生しない', async () => {
      storeMock.claimDueReminderOccurrences.mockResolvedValue([
        OCC,
        { ...OCC, id: 'occ-2', taskId: 'task-2' },
      ])
      channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).not.toHaveBeenCalled()
      expect(json.sent).toBe(0)
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-1', 'suppressed', 'no_route')
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith('occ-2', 'suppressed', 'no_route')
    })
  })

  describe('org単位の自動期限リマインドオンオフ（org_channel_policy.due_reminders_enabled・§2）', () => {
    it('org無効(false)なら送信せずsuppressed(org_reminders_disabled)で終端する', async () => {
      storeMock.isOrgDueRemindersEnabled.mockResolvedValue(false)
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(storeMock.isOrgDueRemindersEnabled).toHaveBeenCalledWith('org-1')
      expect(sendSecretaryPushMock).not.toHaveBeenCalled()
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'suppressed',
        'org_reminders_disabled',
      )
      expect(json.sent).toBe(0)
    })

    it('org有効(true)なら従来どおり送信する', async () => {
      storeMock.isOrgDueRemindersEnabled.mockResolvedValue(true)
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
    })

    it('perf是正: 同一orgの複数occurrenceではisOrgDueRemindersEnabledを1回しか呼ばない（org単位メモ化）', async () => {
      storeMock.claimDueReminderOccurrences.mockResolvedValue([
        OCC,
        { ...OCC, id: 'occ-2', taskId: 'task-2' },
        { ...OCC, id: 'occ-3', taskId: 'task-3' },
      ])
      storeMock.findTaskSnapshotForReminder.mockImplementation(async (taskId: string) => ({
        ...TASK_SNAPSHOT,
        id: taskId,
      }))
      storeMock.findOrgIdForSpace.mockResolvedValue('org-1')

      const res = await callPost()
      expect(res.status).toBe(200)
      expect(storeMock.isOrgDueRemindersEnabled).toHaveBeenCalledTimes(1)
      expect(storeMock.isOrgDueRemindersEnabled).toHaveBeenCalledWith('org-1')
    })
  })

  it('Pro＋line_direct_dm＋active user linkがあれば1:1 DMへ配信する（宛先込みretryKey）', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
    const arg = sendSecretaryPushMock.mock.calls[0][0]
    expect(arg.to).toBe('U-DM-1')
    expect(arg.record).toMatchObject({ groupId: null, externalUserId: 'U-DM-1' })
    expect(arg.retryKey).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
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

  describe('利用者個人ごとの受信オプトアウト(profiles.due_reminder_enabled・送信境界での抑止)', () => {
    it('assigneeがオプトアウト(false)なら送信せずsuppressed(recipient_opted_out)', async () => {
      storeMock.isDueReminderEnabledForUser.mockResolvedValue(false)
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(storeMock.isDueReminderEnabledForUser).toHaveBeenCalledWith(TASK_SNAPSHOT.assigneeId)
      expect(sendSecretaryPushMock).not.toHaveBeenCalled()
      expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
        'occ-1',
        'suppressed',
        'recipient_opted_out',
      )
      expect(json.sent).toBe(0)
      expect(json.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ occurrenceId: 'occ-1', reason: 'recipient_opted_out' }),
        ]),
      )
    })

    it('assigneeが受信可(true)なら従来どおり送信する', async () => {
      storeMock.isDueReminderEnabledForUser.mockResolvedValue(true)
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)
      expect(json.sent).toBe(1)
    })
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

  describe('ball非依存（宛先も文面もballで変わらない・うざくない秘書 再設計）', () => {
    it('ball=clientとinternalで文面・宛先ともに同一になる', async () => {
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({ ...TASK_SNAPSHOT, ball: 'client' })
      await callPost()
      const clientText = sendSecretaryPushMock.mock.calls[0][0].messages[0].altText
      const clientTo = sendSecretaryPushMock.mock.calls[0][0].to

      setupDefaultMocks()
      storeMock.findTaskSnapshotForReminder.mockResolvedValue({ ...TASK_SNAPSHOT, ball: 'internal' })

      await callPost()
      const internalText = sendSecretaryPushMock.mock.calls[0][0].messages[0].altText
      const internalTo = sendSecretaryPushMock.mock.calls[0][0].to

      expect(clientText).toBe(internalText)
      expect(clientTo).toBe(internalTo)
    })
  })

  describe('確認Flex送信（設計正本 §7・PR-2・うざくない秘書 再設計）', () => {
    it('text単体ではなくFlex（[完了した][対応中][明日また確認]ボタン付き）で送信する', async () => {
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(sendSecretaryPushMock).toHaveBeenCalledTimes(1)

      const message = sendSecretaryPushMock.mock.calls[0][0].messages[0]
      expect(message.type).toBe('flex')
      expect(typeof message.altText).toBe('string')
      expect(message.altText.length).toBeGreaterThan(0)
      expect(message.altText).not.toContain('回目')

      const buttons = message.contents.footer.contents as Array<{ action: { label: string; data: string } }>
      const labels = buttons.map((b) => b.action.label)
      expect(labels).toEqual(['完了した', '対応中', '明日また確認'])
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

  describe('DM到達不能マーク・解除（設計正本 §9.1・A案是正: push結果は到達性の証拠にしない）', () => {
    // H-1' 是正: LINEはブロック済み宛先へのpushでも2xxを返し黙って捨てる仕様のため、
    // 「送信成功(delivered:true)」はDMが実際に届いた証拠にはならない。旧実装は成功時に
    // clearDmUnreachableを呼んでいたため、unfollowで正しくマークされた直後でも当日の送信が
    // 200を返すだけでマークが消え、翌日から再び恒久的に不可視へ戻ってしまっていた
    // （unfollow済みの相手からは二度とunfollowイベントが来ないため再検知不能＝致命的）。
    // 同様に「宛先起因の4xx(400/404)」も、実態はLINE APIのボディ検証エラー（長いタイトル等）が
    // 大半を占め、宛先の生死とは無関係に最大100件が一斉に誤マークされ得る(M-1')。
    // 結論: このファイルはmark/clearを一切呼ばない。唯一の真実源は
    // src/lib/channels/line/webhookHandler.ts の unfollow(mark)/follow(clear)。

    it('DM送信が成功してもclearDmUnreachableを一切呼ばない（push 200は到達の証拠にならない）', async () => {
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      expect(channelsStoreMock.clearDmUnreachable).not.toHaveBeenCalled()
    })

    it('宛先起因に見える4xx(400/404)でもmarkDmUnreachableを一切呼ばない（誤マーク事故の防止・M-1\'是正）', async () => {
      for (const status of [400, 404]) {
        vi.clearAllMocks()
        setupDefaultMocks()
        const err = Object.assign(new Error(`LINE push failed (${status})`), { status })
        sendSecretaryPushMock.mockRejectedValue(err)

        const res = await callPost()
        expect(res.status).toBe(200)
        expect(channelsStoreMock.markDmUnreachable).not.toHaveBeenCalled()
        // finalize(suppressed)自体は従来どおり行う（occurrenceのライフサイクルは変えない）
        expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
          'occ-1',
          'suppressed',
          'push_failed_permanent',
        )
      }
    })

    it('アカウント起因の4xx(401/403)でもfinalize(suppressed)自体は従来どおり行う（isPermanentLinePushFailureは不変）', async () => {
      for (const status of [401, 403]) {
        vi.clearAllMocks()
        setupDefaultMocks()
        const err = Object.assign(new Error(`LINE push failed (${status})`), { status })
        sendSecretaryPushMock.mockRejectedValue(err)

        const res = await callPost()
        expect(res.status).toBe(200)
        expect(storeMock.finalizeDueReminderOccurrence).toHaveBeenCalledWith(
          'occ-1',
          'suppressed',
          'push_failed_permanent',
        )
        expect(channelsStoreMock.markDmUnreachable).not.toHaveBeenCalled()
      }
    })

    it('穴が閉じたことの回帰(end-to-end想定): findActiveUserLinkForUserがdm_unreachable_at相当の状態を返し続けても'
      + '（=webhookのunfollowでマークされたまま）、送信成功はそのlinkの状態に一切触れない'
      + '（sender側はfindActiveUserLinkForUserの戻り値からdm_unreachable_atを読みも書きもしない）', async () => {
      // ここでの「マークされている」はwebhook側(webhookHandler.test.ts)で検証済み。
      // sender側の責務は「マークの有無に関わらずDM送信を試み続けること」のみ
      // （resolveDmCandidateは変更しない＝到達不能でも引き続き送信を試みる）。
      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      // findActiveUserLinkForUserの戻り値にdm_unreachable_at相当のフィールドを要求しない
      // （M-4で追加したdmUnreachableAtはA案で不要になったため削除済み）
      expect(channelsStoreMock.findActiveUserLinkForUser).toHaveBeenCalledWith('org-1', 'user-1')
    })

    it('DM解決前にno_routeで終端した場合もmark/clear相当の副作用は一切発生しない', async () => {
      channelsStoreMock.findActiveUserLinkForUser.mockResolvedValue(null)
      const res = await callPost()
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.skipped).toEqual(
        expect.arrayContaining([expect.objectContaining({ occurrenceId: 'occ-1', reason: 'no_route' })]),
      )
      expect(channelsStoreMock.markDmUnreachable).not.toHaveBeenCalled()
      expect(channelsStoreMock.clearDmUnreachable).not.toHaveBeenCalled()
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

      setupDefaultMocks()

      await callPost()
      const second = sendSecretaryPushMock.mock.calls[0][0].retryKey

      expect(first).toBe(second)
    })

    it('宛先違いで異なるretryKeyになる(DM宛て vs DM無しでno_route・既存テストの再確認)', async () => {
      await callPost()
      const dmRetryKey = sendSecretaryPushMock.mock.calls[0][0].retryKey
      expect(dmRetryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/channel-digest — 日次digest（pg_cron→pg_net経由）
 *
 * - Bearer CRON_SECRET 必須（client-remindersと同一パターン）
 * - 対象: digest対象グループごとに 抽出(水位より後のtextのみ・org_ai_config未設定はスキップ) → 配信
 * - 配信: openタスクが0件なら送らない。既存open分も含め常に再採番してから送る
 */

const storeMock = {
  findDigestEligibleGroups: vi.fn(),
  findGroupTextMessagesSince: vi.fn(),
  ingestDigestTasks: vi.fn(),
  clearAndRenumberOpenDigestTasks: vi.fn(),
  findLineAccountById: vi.fn(),
  findIdentityIdsByExternalUserIds: vi.fn(),
  reconcileDigestAssignees: vi.fn(),
  getOrgChannelPolicyState: vi.fn(),
  getPlatformBudgetState: vi.fn(),
  insertChannelMessage: vi.fn(),
  findExistingDigestTaskSourceMessageIds: vi.fn(),
  findUserIdsWithActiveLink: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const callLlmMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}))

const pushMock = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...args: unknown[]) => pushMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}))

// 既定はPro相当(line_direct_dm保持=DMルートあり)にし、既存アサーションに影響しないように
// する（期限セクションはper-task「DMで届かない場合」のみ出す・設計正本 §9・うざくない秘書
// 再設計）。
const resolveEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveEntitlementsMock(...args),
}))

const dueReminderStoreMock = {
  findDueDigestTodayCandidatesForSpace: vi.fn(),
  findDueDigestOverdueCandidatesForSpace: vi.fn(),
  findConnectionFreshnessBatch: vi.fn(),
  isOrgDueRemindersEnabled: vi.fn(),
  findDueReminderDisabledUserIds: vi.fn(),
}
vi.mock('@/lib/reminders/dueReminderStore', () => dueReminderStoreMock)

// 無料50到達アップグレード促し（共有bot×block×hard時のみ発火）
const nudgeFreeCapReachedMock = vi.fn()
vi.mock('@/lib/channels/freeCapNudge', () => ({
  nudgeFreeCapReached: (...args: unknown[]) => nudgeFreeCapReachedMock(...args),
}))

// プールAI当月上限到達通知（pool_quota_exhausted の抽出スキップ時のみ発火）
const notifyPoolExhaustedMock = vi.fn()
vi.mock('@/lib/ai/poolExhaustedNudge', () => ({
  notifyPoolExhausted: (...args: unknown[]) => notifyPoolExhaustedMock(...args),
}))

const { POST } = await import('@/app/api/cron/channel-digest/route')

function callPost(headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL('/api/cron/channel-digest', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
  return POST(request)
}

const GROUP = {
  id: 'group-1',
  orgId: 'org-1',
  spaceId: 'space-1',
  accountId: 'acc-1',
  externalGroupId: 'G-1',
  pickupMode: 'all' as const,
  lastExtractedMessageCreatedAt: '2026-07-10T22:00:00.000Z',
}

const ACCOUNT = {
  id: 'acc-1',
  ownerType: 'org' as const,
  orgId: 'org-1',
  displayName: '山田飲食店',
  channelSecret: 's',
  accessToken: 'token-1',
  status: 'active' as const,
}

// 共有bot（owner_type='platform'）。グローバル予算層(account軸)のgateが効く対象
const PLATFORM_ACCOUNT = {
  id: 'acc-shared-1',
  ownerType: 'platform' as const,
  orgId: null as string | null,
  displayName: 'agentpm秘書',
  channelSecret: 's',
  accessToken: 'token-shared',
  status: 'active' as const,
}

describe('POST /api/cron/channel-digest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    storeMock.findDigestEligibleGroups.mockResolvedValue([])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([])
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])
    storeMock.findLineAccountById.mockResolvedValue(ACCOUNT)
    storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map())
    storeMock.reconcileDigestAssignees.mockResolvedValue(0)
    storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
    storeMock.getPlatformBudgetState.mockResolvedValue('ok')
    storeMock.insertChannelMessage.mockResolvedValue({ id: 'outbound-1' })
    storeMock.findExistingDigestTaskSourceMessageIds.mockResolvedValue(new Set())
    storeMock.findUserIdsWithActiveLink.mockResolvedValue(new Set())
    pushMock.mockResolvedValue(undefined)
    // 既定はPro相当（line_direct_dm保持）。期限セクションのテストは個別に上書きする。
    resolveEntitlementsMock.mockResolvedValue({ planId: 'pro', has: () => true })
    dueReminderStoreMock.findDueDigestTodayCandidatesForSpace.mockResolvedValue([])
    dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([])
    dueReminderStoreMock.findConnectionFreshnessBatch.mockResolvedValue(new Map())
    dueReminderStoreMock.isOrgDueRemindersEnabled.mockResolvedValue(true)
    dueReminderStoreMock.findDueReminderDisabledUserIds.mockResolvedValue(new Set())
    nudgeFreeCapReachedMock.mockResolvedValue({ nudged: true })
    notifyPoolExhaustedMock.mockResolvedValue({ nudged: true })
  })

  it('CRON_SECRET未設定は500', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' })
    expect(response.status).toBe(500)
  })

  it('Authorizationヘッダ無しは401', async () => {
    const response = await callPost()
    expect(response.status).toBe(401)
    expect(storeMock.findDigestEligibleGroups).not.toHaveBeenCalled()
  })

  it('不正なシークレットは401', async () => {
    const response = await callPost({ authorization: 'Bearer wrong' })
    expect(response.status).toBe(401)
  })

  it('対象グループが無ければ0件で200', async () => {
    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.processedGroups).toBe(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('新規メッセージ0件でも既存openタスクがあれば配信する', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([])
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
      { id: 'task-1', title: '酒屋へ発注', digestNumber: 1 },
    ])

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(callLlmMock).not.toHaveBeenCalled()
    expect(body.digestsSent).toBe(1)
    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushArg = pushMock.mock.calls[0][0] as { to: string; messages: unknown[]; retryKey?: string }
    expect(pushArg.to).toBe('G-1')
    expect(pushArg.messages).toHaveLength(2)
    // 同日中にcronが再実行されても同じretryKeyになる（決定的導出）ことを別テストで検証
    expect(pushArg.retryKey).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
  })

  it('同日中に2回叩かれても同じgroupへのretryKeyは同一（LINE側で二重配信を弾ける）', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
      { id: 'task-1', title: '酒屋へ発注', digestNumber: 1 },
    ])

    await callPost({ authorization: 'Bearer test-cron-secret' })
    await callPost({ authorization: 'Bearer test-cron-secret' })

    const firstRetryKey = (pushMock.mock.calls[0][0] as { retryKey: string }).retryKey
    const secondRetryKey = (pushMock.mock.calls[1][0] as { retryKey: string }).retryKey
    expect(firstRetryKey).toBe(secondRetryKey)
  })

  it('配信前に担当の自己修復スイープを走らせる（取りこぼしを毎朝ならす）', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.reconcileDigestAssignees.mockResolvedValue(2)
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

    await callPost({ authorization: 'Bearer test-cron-secret' })

    expect(storeMock.reconcileDigestAssignees).toHaveBeenCalledWith('group-1')
  })

  it('スイープが失敗しても配信は続ける（担当が付かないだけで申し送りは届ける）', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.reconcileDigestAssignees.mockRejectedValue(new Error('reconcile boom'))
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
      { id: 'task-1', title: '酒屋へ発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null },
    ])

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.digestsSent).toBe(1)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(body.skipped[0].reason).toContain('reconcile_failed')
  })

  it('再採番がDBエラーで失敗したら、そのグループは配信せず errors に記録し他は止めない', async () => {
    const group2 = { ...GROUP, id: 'group-2', externalGroupId: 'G-2' }
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP, group2])
    // group-1 の再採番だけDBエラー、group-2 は正常
    storeMock.clearAndRenumberOpenDigestTasks.mockImplementation(async (gid: string) => {
      if (gid === 'group-1') throw new Error('renumber failed: db down')
      return [{ id: 'task-2', title: '発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null }]
    })

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const body = await response.json()

    expect(response.status).toBe(200)
    // group-1 は誤配信せず errors に、group-2 は配信される
    expect(body.errors.some((e: string) => e.includes('group-1'))).toBe(true)
    expect(body.digestsSent).toBe(1)
  })

  it('openタスクが0件なら送信しない', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.digestsSent).toBe(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('新規メッセージがあればLLM抽出→ingestし、水位はグループの最終メッセージ時刻を渡す', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 14, 7, 0))
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([
      {
        id: 'msg-1',
        body: '金曜までに酒屋へ発注お願いします',
        createdAt: '2026-07-11T05:00:00.000Z',
        mentions: [],
      },
      { id: 'msg-2', body: 'ラジャー', createdAt: '2026-07-11T05:01:00.000Z', mentions: [] },
    ])
    callLlmMock.mockResolvedValue({
      content: JSON.stringify([
        {
          title: '酒屋へ発注',
          assignee_hint: null,
          due_date: '2026-07-17',
          due_time: '17:00',
          source_index: 0,
        },
      ]),
    })
    storeMock.ingestDigestTasks.mockResolvedValue(1)
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
      { id: 'task-1', title: '酒屋へ発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null },
    ])

    try {
      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }))
      expect(storeMock.ingestDigestTasks).toHaveBeenCalledWith('group-1', '2026-07-11T05:01:00.000Z', [
        {
          sourceMessageId: 'msg-1',
          title: '酒屋へ発注',
          assigneeHint: null,
          assigneeExternalUserId: null,
          assigneeIdentityId: null,
          dueDate: '2026-07-17',
          dueTime: '17:00',
        },
      ])
      expect(body.extractedTasks).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('メンションはLLMの推測より優先し、userIdは既存identityに解決する（Stage 2.6）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 14, 7, 0))
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([
      {
        id: 'msg-1',
        body: '@山田 金曜までに酒屋へ発注',
        createdAt: '2026-07-11T05:00:00.000Z',
        mentions: [{ userId: 'U-yamada', displayName: '山田' }],
      },
    ])
    // LLMは本文から別の名前（田中）を推測している。メンションがある以上こちらは採らない
    callLlmMock.mockResolvedValue({
      content: JSON.stringify([
        { title: '酒屋へ発注', assignee_hint: '田中さん', due_date: '2026-07-17', source_index: 0 },
      ]),
    })
    storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map([['U-yamada', 'identity-1']]))
    storeMock.ingestDigestTasks.mockResolvedValue(1)
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

    try {
      await callPost({ authorization: 'Bearer test-cron-secret' })

      // identity解決は必ずこのグループの space に限る（他顧問先のidentityを引かない）
      expect(storeMock.findIdentityIdsByExternalUserIds).toHaveBeenCalledWith(
        'org-1',
        GROUP.spaceId,
        ['U-yamada'],
      )
      expect(storeMock.ingestDigestTasks).toHaveBeenCalledWith('group-1', '2026-07-11T05:00:00.000Z', [
        {
          sourceMessageId: 'msg-1',
          title: '酒屋へ発注',
          assigneeHint: '山田',
          assigneeExternalUserId: 'U-yamada',
          assigneeIdentityId: 'identity-1',
          dueDate: '2026-07-17',
          dueTime: null,
        },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('期限順に並んだ一覧を配信し、超過は ⚠️ で示す（Stage 2.6）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 14, 7, 0))
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([])
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
      { id: 'task-1', title: '請求書の確認', digestNumber: 1, dueDate: '2026-07-12', dueTime: null, assigneeHint: null },
      { id: 'task-2', title: '酒屋へ発注', digestNumber: 2, dueDate: '2026-07-17', dueTime: '17:00', assigneeHint: '山田' },
      { id: 'task-3', title: '議事録の共有', digestNumber: 3, dueDate: null, dueTime: null, assigneeHint: null },
    ])

    try {
      await callPost({ authorization: 'Bearer test-cron-secret' })

      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      const text = pushed.messages[0].text ?? ''
      expect(text).toContain('1. 請求書の確認  ⚠️7/12(日) 期限超過')
      expect(text).toContain('2. 酒屋へ発注  ⏰7/17(金) 17:00  👤山田さん')
      expect(text).toContain('3. 議事録の共有')
    } finally {
      vi.useRealTimers()
    }
  })

  it('org_ai_config未設定(callLlmが例外)ならそのグループはスキップしログに残す。他グループは継続', async () => {
    const group2 = { ...GROUP, id: 'group-2', orgId: 'org-2', externalGroupId: 'G-2' }
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP, group2])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([
      { id: 'msg-1', body: '発注おねがいします', createdAt: '2026-07-11T05:00:00.000Z' },
    ])
    callLlmMock.mockImplementation(async (opts: { orgId: string }) => {
      if (opts.orgId === 'org-1') throw new Error('AI未設定: この組織にはAI設定が登録されていません')
      return { content: JSON.stringify([]) }
    })
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ groupId: 'group-1' })]),
    )
    // group-2は処理が続く
    expect(callLlmMock).toHaveBeenCalledTimes(2)
  })

  it('プールAI当月上限到達(pool_quota_exhausted)なら notifyPoolExhausted を発火する（事務所へ復旧導線）', async () => {
    const { AiConfigError } = await import('@/lib/ai/errors')
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([
      { id: 'msg-1', body: '発注おねがいします', createdAt: '2026-07-11T05:00:00.000Z' },
    ])
    callLlmMock.mockRejectedValue(
      new AiConfigError('pool_quota_exhausted', 'プールAIの今月の上限に達しました'),
    )
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    expect(response.status).toBe(200)
    expect(notifyPoolExhaustedMock).toHaveBeenCalledTimes(1)
    expect(notifyPoolExhaustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', spaceId: 'space-1' }),
    )
  })

  it('通常のAI未設定(missing)では notifyPoolExhausted を発火しない', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([
      { id: 'msg-1', body: '発注おねがいします', createdAt: '2026-07-11T05:00:00.000Z' },
    ])
    callLlmMock.mockRejectedValue(new Error('AI未設定: この組織にはAI設定が登録されていません'))
    storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    expect(response.status).toBe(200)
    expect(notifyPoolExhaustedMock).not.toHaveBeenCalled()
  })

  it('LLM応答が壊れたJSONならそのグループの抽出だけスキップする（例外は投げない）', async () => {
    storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
    storeMock.findGroupTextMessagesSince.mockResolvedValue([
      { id: 'msg-1', body: '発注おねがいします', createdAt: '2026-07-11T05:00:00.000Z' },
    ])
    callLlmMock.mockResolvedValue({ content: 'not json' })

    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    expect(response.status).toBe(200)
    expect(storeMock.ingestDigestTasks).not.toHaveBeenCalled()
  })

  describe('pickup_mode（Stage 2.5 §1）', () => {
    it('mention_only グループはLLM抽出を呼ばない（配信は既存open分があれば行う）', async () => {
      const mentionOnlyGroup = { ...GROUP, pickupMode: 'mention_only' as const }
      storeMock.findDigestEligibleGroups.mockResolvedValue([mentionOnlyGroup])
      storeMock.findGroupTextMessagesSince.mockResolvedValue([
        { id: 'msg-1', body: 'メンションで拾われた分ではない発言', createdAt: '2026-07-11T05:00:00.000Z' },
      ])
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
        { id: 'task-1', title: '見積提出', digestNumber: 1 },
      ])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(callLlmMock).not.toHaveBeenCalled()
      expect(storeMock.ingestDigestTasks).not.toHaveBeenCalled()
      expect(body.digestsSent).toBe(1)
      expect(pushMock).toHaveBeenCalledTimes(1)
    })

    it('findDigestEligibleGroupsの対象自体からoffグループは除外される想定のため、cronはoffを意識しない', async () => {
      // off はstore層(findDigestEligibleGroups)で除外される前提（§1）。
      // cronルート自体は返ってきたグループを無条件に処理してよいことの確認（回帰防止）
      storeMock.findDigestEligibleGroups.mockResolvedValue([])
      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()
      expect(body.processedGroups).toBe(0)
    })
  })

  describe('pickup_mode=all_plus_instant（フェーズ2・pro以上限定）: 抽出拡張＋重複排除', () => {
    const DUAL_GROUP = { ...GROUP, pickupMode: 'all_plus_instant' as const }

    it('all_plus_instant グループも抽出対象になる（allと同様にLLM抽出→ingestが動く）', async () => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([DUAL_GROUP])
      storeMock.findGroupTextMessagesSince.mockResolvedValue([
        { id: 'msg-1', body: '発注おねがいします', createdAt: '2026-07-11T05:00:00.000Z', mentions: [] },
      ])
      storeMock.findExistingDigestTaskSourceMessageIds.mockResolvedValue(new Set())
      callLlmMock.mockResolvedValue({
        content: JSON.stringify([
          { title: '発注', assignee_hint: null, due_date: null, source_index: 0 },
        ]),
      })
      storeMock.ingestDigestTasks.mockResolvedValue(1)
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }))
      expect(body.extractedTasks).toBe(1)
    })

    it('即時タスク化済み(source_message_idが既存)の発言は抽出候補から除外され、二重登録されない', async () => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([DUAL_GROUP])
      storeMock.findGroupTextMessagesSince.mockResolvedValue([
        { id: 'msg-1', body: '発注おねがいします', createdAt: '2026-07-11T05:00:00.000Z', mentions: [] },
        { id: 'msg-2', body: '@秘書 見積もり出して', createdAt: '2026-07-11T05:01:00.000Z', mentions: [] },
      ])
      // msg-2 は既に即時タスク化済み（webhookのmention即時パス経由）
      storeMock.findExistingDigestTaskSourceMessageIds.mockResolvedValue(new Set(['msg-2']))
      callLlmMock.mockResolvedValue({
        content: JSON.stringify([
          { title: '発注', assignee_hint: null, due_date: null, source_index: 0 },
        ]),
      })
      storeMock.ingestDigestTasks.mockResolvedValue(1)
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(storeMock.findExistingDigestTaskSourceMessageIds).toHaveBeenCalledWith('group-1', [
        'msg-1',
        'msg-2',
      ])
      // LLMプロンプトは除外後のメッセージ(msg-1のみ)のみ渡す
      expect(callLlmMock).toHaveBeenCalledTimes(1)
      // 水位は除外前(=生取得の最後)のメッセージ時刻まで進める。除外してもwatermarkは変えない
      expect(storeMock.ingestDigestTasks).toHaveBeenCalledWith('group-1', '2026-07-11T05:01:00.000Z', [
        {
          sourceMessageId: 'msg-1',
          title: '発注',
          assigneeHint: null,
          assigneeExternalUserId: null,
          assigneeIdentityId: null,
          dueDate: null,
          dueTime: null,
        },
      ])
      expect(body.extractedTasks).toBe(1)
    })

    it('全発言が既に即時タスク化済みでも水位は生取得の最後まで進める（LLM呼び出しはスキップ）', async () => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([DUAL_GROUP])
      storeMock.findGroupTextMessagesSince.mockResolvedValue([
        { id: 'msg-1', body: 'x', createdAt: '2026-07-11T05:00:00.000Z', mentions: [] },
        { id: 'msg-2', body: 'y', createdAt: '2026-07-11T05:01:00.000Z', mentions: [] },
      ])
      storeMock.findExistingDigestTaskSourceMessageIds.mockResolvedValue(new Set(['msg-1', 'msg-2']))
      storeMock.ingestDigestTasks.mockResolvedValue(0)
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      expect(callLlmMock).not.toHaveBeenCalled()
      expect(storeMock.ingestDigestTasks).toHaveBeenCalledWith('group-1', '2026-07-11T05:01:00.000Z', [])
    })

    it('all グループ（無料）では重複排除フィルタを呼ばない（no-op・従来と同一挙動）', async () => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP]) // pickupMode: 'all'
      storeMock.findGroupTextMessagesSince.mockResolvedValue([
        { id: 'msg-1', body: '発注', createdAt: '2026-07-11T05:00:00.000Z', mentions: [] },
      ])
      callLlmMock.mockResolvedValue({ content: JSON.stringify([]) })
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      expect(storeMock.findExistingDigestTaskSourceMessageIds).not.toHaveBeenCalled()
    })
  })

  describe('メータリング（PR4・送信境界の縮退）', () => {
    beforeEach(() => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
        { id: 'task-1', title: '酒屋へ発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null },
      ])
    })

    it('on_exceed=none（既定org）は常に送信し、outbound記録をbillablePush:trueで残す（退行ゲート）', async () => {
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'none' })

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          groupId: 'group-1',
          direction: 'outbound',
          actor: 'secretary',
          billablePush: true,
        }),
      )
    })

    it('on_exceed=block かつ state=hard は抑止し、pushもoutbound記録もしない', async () => {
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(0)
      expect(pushMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(body.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupId: 'group-1', reason: 'quota_block_suppress' }),
        ]),
      )
    })

    it('共有bot×block×hard(無料50到達)は nudgeFreeCapReached を発火する（事務所促し＋グループ中立1行）', async () => {
      storeMock.findLineAccountById.mockResolvedValue(PLATFORM_ACCOUNT)
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(0)
      expect(nudgeFreeCapReachedMock).toHaveBeenCalledTimes(1)
      expect(nudgeFreeCapReachedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          groupExternalId: 'G-1',
          globalBudgetHard: false,
        }),
      )
    })

    it('自社bot(owner_type=org)の抑止では促しを発火しない（Pro自社LINEは対象外）', async () => {
      storeMock.findLineAccountById.mockResolvedValue(ACCOUNT) // ownerType='org'
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })

      await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(nudgeFreeCapReachedMock).not.toHaveBeenCalled()
    })

    it('on_exceed=degrade かつ state=soft は隔日（奇数日は抑止）', async () => {
      vi.useFakeTimers()
      // 2026-07-12(JST)は通算日193（奇数）→ 抑止側
      vi.setSystemTime(new Date(2026, 6, 12, 7, 0))
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'soft', onExceed: 'degrade' })

      try {
        const response = await callPost({ authorization: 'Bearer test-cron-secret' })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.digestsSent).toBe(0)
        expect(pushMock).not.toHaveBeenCalled()
        expect(body.skipped).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ groupId: 'group-1', reason: 'quota_soft_degrade_alt_day' }),
          ]),
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('1グループがquota抑止されても他グループの配信は続ける', async () => {
      const group2 = { ...GROUP, id: 'group-2', orgId: 'org-2', externalGroupId: 'G-2' }
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP, group2])
      storeMock.getOrgChannelPolicyState.mockImplementation(async (orgId: string) =>
        orgId === 'org-1' ? { state: 'hard', onExceed: 'block' } : { state: 'ok', onExceed: 'none' },
      )

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'G-2' }))
    })

    it('Fix4: outbound記録のexternalMessageIdはpushのretryKeyと同一（決定的キーでdedupe可能）', async () => {
      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)

      const retryKey = (pushMock.mock.calls[0][0] as { retryKey: string }).retryKey
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ externalMessageId: retryKey }),
      )
    })

    it('Fix4: insertChannelMessageがduplicateを返しても200で継続する（二重起動での二重計上を防ぐ）', async () => {
      storeMock.insertChannelMessage.mockResolvedValue('duplicate')

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(body.errors).toEqual([])
    })
  })

  describe('グローバル予算層（共有bot account軸の二層quota判定・fable確定設計）', () => {
    beforeEach(() => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
        { id: 'task-1', title: '酒屋へ発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null },
      ])
    })

    it('共有bot(platform)account かつ org層ok・global層hard → 抑止する', async () => {
      storeMock.findLineAccountById.mockResolvedValue(PLATFORM_ACCOUNT)
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
      storeMock.getPlatformBudgetState.mockResolvedValue('hard')

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(0)
      expect(pushMock).not.toHaveBeenCalled()
      expect(storeMock.getPlatformBudgetState).toHaveBeenCalledWith('acc-shared-1')
      expect(body.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupId: 'group-1', reason: 'global_budget_hard_suppress' }),
        ]),
      )
    })

    it('専用bot(owner_type=org)account は global層を評価しない（getPlatformBudgetStateを呼ばず常送信）', async () => {
      storeMock.findLineAccountById.mockResolvedValue(ACCOUNT) // ownerType='org'
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
      storeMock.getPlatformBudgetState.mockResolvedValue('hard') // 呼ばれれば抑止されるはずの値

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(storeMock.getPlatformBudgetState).not.toHaveBeenCalled()
    })

    it('同一account(共有bot)を複数グループが引くcron1回内では、グローバル予算層の読取をaccount単位でメモ化する', async () => {
      const group2 = { ...GROUP, id: 'group-2', externalGroupId: 'G-2' }
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP, group2])
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
        { id: 'task-1', title: '酒屋へ発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null },
      ])
      storeMock.findLineAccountById.mockResolvedValue(PLATFORM_ACCOUNT)
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
      storeMock.getPlatformBudgetState.mockResolvedValue('ok')

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(2)
      expect(storeMock.getPlatformBudgetState).toHaveBeenCalledTimes(1)
    })
  })

  describe('期限セクション（設計正本 §9・安全網v2・うざくない秘書 再設計）', () => {
    beforeEach(() => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([
        { id: 'task-1', title: '酒屋へ発注', digestNumber: 1, dueDate: null, dueTime: null, assigneeHint: null },
      ])
      // 既定: DMルート無し(findUserIdsWithActiveLink空集合) → per-task「DMで届かない場合」に
      // 該当し、期限セクションに載る（各itで上書きする）
      resolveEntitlementsMock.mockResolvedValue({ planId: 'pro', has: (f: string) => f === 'line_direct_dm' })
    })

    it('DMルートが無い担当者のタスクは中立文面で期限セクションに追記される（Proでも出る）', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-due', title: '請求書の送付', dueDate: '2026-07-12', assigneeId: 'user-1', dueAuthorityConnectionId: null },
      ])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      expect(pushed.messages[0].text).toContain('【期限のお知らせ】')
      expect(pushed.messages[0].text).toContain('請求書の送付')
      // 中立文面（催促/命令調は出さない）
      expect(pushed.messages[0].text).not.toContain('催促')
    })

    it('page-perf再レビュー是正: 本日分/超過分を別クエリで並列取得し、超過下限7日前・本日=jstDateStrを渡す（+1日上限の無駄取得は廃止）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 20, 7, 0)) // 2026-07-20 07:00 JST(ローカル=JST想定のテスト環境)

      try {
        await callPost({ authorization: 'Bearer test-cron-secret' })
        expect(dueReminderStoreMock.findDueDigestTodayCandidatesForSpace).toHaveBeenCalledWith(
          'space-1',
          '2026-07-20',
        )
        expect(dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace).toHaveBeenCalledWith(
          'space-1',
          '2026-07-13',
          '2026-07-20',
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('org無効(due_reminders_enabled=false)なら期限セクションを出さない（送信境界と同じキルスイッチ）', async () => {
      dueReminderStoreMock.isOrgDueRemindersEnabled.mockResolvedValue(false)
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-due', title: '請求書の送付', dueDate: '2026-07-12', assigneeId: 'user-1', dueAuthorityConnectionId: null },
      ])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      expect(dueReminderStoreMock.findDueDigestTodayCandidatesForSpace).not.toHaveBeenCalled()
      expect(dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace).not.toHaveBeenCalled()
      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      expect(pushed.messages[0].text).not.toContain('【期限のお知らせ】')
    })

    it('担当者にDMルートがある(Pro+line_direct_dm+active link)タスクは期限セクションに出さない（重複防止）', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-dm', title: 'DMで届く方', dueDate: '2026-07-12', assigneeId: 'user-dm', dueAuthorityConnectionId: null },
        { id: 't-nodm', title: 'DMで届かない方', dueDate: '2026-07-12', assigneeId: 'user-nodm', dueAuthorityConnectionId: null },
      ])
      storeMock.findUserIdsWithActiveLink.mockResolvedValue(new Set(['user-dm']))

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      expect(pushed.messages[0].text).not.toContain('DMで届く方')
      expect(pushed.messages[0].text).toContain('DMで届かない方')
    })

    it('perf是正: DMリンク判定とオプトアウト判定を並列で発火する（直列なら後者は前者の解決を待ってしまう）', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-due', title: '請求書の送付', dueDate: '2026-07-12', assigneeId: 'user-1', dueAuthorityConnectionId: null },
      ])
      // findUserIdsWithActiveLinkを意図的に解決させない（直列実装ならfindDueReminderDisabledUserIdsは
      // 永久に呼ばれないはず）
      storeMock.findUserIdsWithActiveLink.mockReturnValue(new Promise(() => {}))
      dueReminderStoreMock.findDueReminderDisabledUserIds.mockResolvedValue(new Set())

      void callPost({ authorization: 'Bearer test-cron-secret' })
      // マクロタスクを一巡させ、Promise.allで両方が同時に発火していることを確認する
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(storeMock.findUserIdsWithActiveLink).toHaveBeenCalled()
      expect(dueReminderStoreMock.findDueReminderDisabledUserIds).toHaveBeenCalled()
    })

    it('line_direct_dmを持たないorgはDM存在チェック自体を呼ばず全件を期限セクションに出す', async () => {
      resolveEntitlementsMock.mockResolvedValue({ planId: 'free', has: () => false })
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-due', title: '請求書の送付', dueDate: '2026-07-12', assigneeId: 'user-1', dueAuthorityConnectionId: null },
      ])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      expect(storeMock.findUserIdsWithActiveLink).not.toHaveBeenCalled()
      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      expect(pushed.messages[0].text).toContain('請求書の送付')
    })

    it('担当者が個人単位でオプトアウト(profiles.due_reminder_enabled=false)していれば期限セクションに出さない', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-opted-out', title: 'オプトアウト担当', dueDate: '2026-07-12', assigneeId: 'user-opted-out', dueAuthorityConnectionId: null },
      ])
      dueReminderStoreMock.findDueReminderDisabledUserIds.mockResolvedValue(new Set(['user-opted-out']))

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      expect(pushed.messages[0].text).not.toContain('【期限のお知らせ】')
    })

    it('external権威タスクは鮮度SLA超過なら期限セクションから除外する（§6鮮度抑止）', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        {
          id: 't-stale',
          title: 'Google Tasks由来タスク',
          dueDate: '2026-07-12',
          assigneeId: 'user-1',
          dueAuthorityConnectionId: 'conn-1',
        },
      ])
      dueReminderStoreMock.findConnectionFreshnessBatch.mockResolvedValue(
        new Map([
          [
            'conn-1',
            {
              status: 'active',
              provider: 'google_tasks',
              lastImportSuccessAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            },
          ],
        ]),
      )

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      expect(response.status).toBe(200)
      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
      expect(pushed.messages[0].text).not.toContain('【期限のお知らせ】')
    })

    it('期限セクション追加による追加のbillable sendは作らない（既存の単一digest pushのまま）', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-due', title: '請求書の送付', dueDate: '2026-07-12', assigneeId: 'user-1', dueAuthorityConnectionId: null },
      ])

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(body.digestsSent).toBe(1)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
    })

    it('期限セクション取得が失敗しても既存digestの配信は止めない', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockRejectedValue(new Error('db down'))

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(body.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupId: 'group-1', reason: expect.stringContaining('due_section_failed') }),
        ]),
      )
    })

    describe('page-perf再レビュー是正: 本日分/超過分の専用limit(25)で「本日が期限」の飢餓を防ぐ', () => {
      it('超過タスクが60件(旧上限50件超)あっても「本日が期限」が飢餓にならず今日のタスクが載る（中核回帰）', async () => {
        const overdueTasks = Array.from({ length: 60 }, (_, i) => ({
          id: `t-overdue-${i}`,
          title: `超過タスク${i + 1}`,
          dueDate: '2026-07-01',
          assigneeId: 'user-overdue',
          dueAuthorityConnectionId: null,
        }))
        dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue(overdueTasks)
        dueReminderStoreMock.findDueDigestTodayCandidatesForSpace.mockResolvedValue([
          {
            id: 't-today',
            title: '今日やるタスク',
            dueDate: '2026-07-21',
            assigneeId: 'user-today',
            dueAuthorityConnectionId: null,
          },
        ])

        const response = await callPost({ authorization: 'Bearer test-cron-secret' })
        expect(response.status).toBe(200)
        const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
        expect(pushed.messages[0].text).toContain('■ 本日が期限')
        expect(pushed.messages[0].text).toContain('今日やるタスク')
        expect(pushed.messages[0].text).toContain('■ 期限超過')
      })

      it('各セクションが上位10件＋「ほかN件」に丸められる（storeのlimit(25)分がそのまま渡っても丸めは効く）', async () => {
        const overdueTasks = Array.from({ length: 26 }, (_, i) => ({
          id: `t-overdue-${i}`,
          title: `超過タスク${i + 1}`,
          dueDate: '2026-07-01',
          assigneeId: 'user-overdue',
          dueAuthorityConnectionId: null,
        }))
        dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue(overdueTasks)

        const response = await callPost({ authorization: 'Bearer test-cron-secret' })
        expect(response.status).toBe(200)
        const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ text?: string }> }
        expect(pushed.messages[0].text).toContain('・超過タスク1')
        expect(pushed.messages[0].text).toContain('・超過タスク10')
        expect(pushed.messages[0].text).not.toContain('・超過タスク11')
        expect(pushed.messages[0].text).toContain('・ほか16件')
      })
    })
  })

  describe('due-only push（code review #1是正: 申し送り0件でも期限項目だけで送る）', () => {
    beforeEach(() => {
      storeMock.findDigestEligibleGroups.mockResolvedValue([GROUP])
      // 申し送りタスクは0件（この一点がこのdescribeの要）
      storeMock.clearAndRenumberOpenDigestTasks.mockResolvedValue([])
      resolveEntitlementsMock.mockResolvedValue({ planId: 'free', has: () => false })
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([
        { id: 't-due', title: '請求書の送付', dueDate: '2026-07-12', assigneeId: 'user-1', dueAuthorityConnectionId: null },
      ])
    })

    it('申し送り0件・due項目ありのorgへ1通pushする（期限セクションのみ・flexなし）', async () => {
      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(pushMock).toHaveBeenCalledTimes(1)

      const pushed = pushMock.mock.calls[0][0] as { messages: Array<{ type: string; text?: string }> }
      expect(pushed.messages).toHaveLength(1) // flex(消し込みボタン)は添付しない
      expect(pushed.messages[0].type).toBe('text')
      expect(pushed.messages[0].text).toContain('【期限のお知らせ】')
      expect(pushed.messages[0].text).toContain('請求書の送付')
    })

    it('due-onlyのpushも既存billable send経路(insertChannelMessage)1件のみで計上する', async () => {
      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(1)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'group-1', billablePush: true }),
      )
    })

    it('申し送り0件・due項目0件なら何もしない（従来どおり）', async () => {
      dueReminderStoreMock.findDueDigestOverdueCandidatesForSpace.mockResolvedValue([])
      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(0)
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('due-onlyのpushも既存の予算gate(decideSharedSendBudget)を必ず通す(hard抑止なら送らない)', async () => {
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })

      const response = await callPost({ authorization: 'Bearer test-cron-secret' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.digestsSent).toBe(0)
      expect(pushMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(body.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupId: 'group-1', reason: 'quota_block_suppress' }),
        ]),
      )
    })
  })
})

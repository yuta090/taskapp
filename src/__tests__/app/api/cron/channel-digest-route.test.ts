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
  orgId: 'org-1',
  displayName: '山田飲食店',
  channelSecret: 's',
  accessToken: 'token-1',
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
    pushMock.mockResolvedValue(undefined)
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
})

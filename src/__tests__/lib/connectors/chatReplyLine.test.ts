import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/connectors/chatReplyLine.ts — multica 完了(task.completed)を発生元チャットへ返信する
 * ChatReplySender 実装。発生元グループの逆引き → LINE-first の資格情報復号 → 共有bot送信境界の
 * 二層メータリング → pushLineMessage → 課金メータ計上、の配線を検証する。
 *
 * メータリング合成(decideSharedSendBudget)は純粋関数なので実物を通し、state 取得のみモックする
 * (org層/global層の合成が実際に効くことまで検証する)。
 */

const findChatOriginGroupForTask = vi.fn()
const findGroupById = vi.fn()
const findLineAccountById = vi.fn()
const getOrgChannelPolicyState = vi.fn()
const getPlatformBudgetState = vi.fn()
const insertChannelMessage = vi.fn()
vi.mock('@/lib/channels/store', () => ({
  findChatOriginGroupForTask: (...a: unknown[]) => findChatOriginGroupForTask(...a),
  findGroupById: (...a: unknown[]) => findGroupById(...a),
  findLineAccountById: (...a: unknown[]) => findLineAccountById(...a),
  getOrgChannelPolicyState: (...a: unknown[]) => getOrgChannelPolicyState(...a),
  getPlatformBudgetState: (...a: unknown[]) => getPlatformBudgetState(...a),
  insertChannelMessage: (...a: unknown[]) => insertChannelMessage(...a),
}))

const pushLineMessage = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...a: unknown[]) => pushLineMessage(...a),
}))

// getJstDayOfYear は偶数日を返させて soft縮退(隔日)の分岐を決定的にする。
vi.mock('@/lib/channels/metering/decideAutoPush', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, getJstDayOfYear: () => 2 }
})

import { toLineRetryKey } from '@/lib/channels/line/retryKey'

const { lineChatReplySender, buildCompletionReplyText } = await import('@/lib/connectors/chatReplyLine')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const ORG = 'org-1'
const GROUP = 'group-1'
const ACCOUNT = 'acct-1'
const EXTERNAL_GROUP = 'Cline-group-xyz'

function activeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    orgId: ORG,
    spaceId: 'space-1',
    accountId: ACCOUNT,
    externalGroupId: EXTERNAL_GROUP,
    displayName: 'テスト相手先',
    status: 'active',
    pickupMode: 'all',
    lastExtractedMessageCreatedAt: null,
    approverUserId: null,
    ...overrides,
  }
}

function orgAccount(overrides: Record<string, unknown> = {}) {
  return {
    ownerType: 'org',
    id: ACCOUNT,
    orgId: ORG,
    displayName: 'OA',
    channelSecret: 'sec',
    accessToken: 'tok-abc',
    status: 'active',
    ...overrides,
  }
}

const payload = (o: Record<string, unknown> = {}) => ({
  taskRef: 'task-1',
  summary: '発注を完了しました',
  artifactUrl: 'https://example.com/a',
  idempotencyKey: 'evt-99',
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  findChatOriginGroupForTask.mockResolvedValue({ groupId: GROUP, orgId: ORG })
  findGroupById.mockResolvedValue(activeGroup())
  findLineAccountById.mockResolvedValue(orgAccount())
  getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
  getPlatformBudgetState.mockResolvedValue('ok')
  insertChannelMessage.mockResolvedValue({ id: 'msg-1' })
  pushLineMessage.mockResolvedValue(undefined)
})

describe('lineChatReplySender', () => {
  it('発生元チャット無し(逆引きnull)は delivered:false・送信しない', async () => {
    findChatOriginGroupForTask.mockResolvedValue(null)
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
    expect(insertChannelMessage).not.toHaveBeenCalled()
  })

  it('グループが left/欠損なら delivered:false', async () => {
    findGroupById.mockResolvedValue(activeGroup({ status: 'left' }))
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
  })

  it('LINEアカウント復号不能/非LINE(null)は delivered:false(LINE-first)', async () => {
    findLineAccountById.mockResolvedValue(null)
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
  })

  it('アカウントが disabled なら delivered:false', async () => {
    findLineAccountById.mockResolvedValue(orgAccount({ status: 'disabled' }))
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
  })

  it('happy path(org account): 発生元グループへ push・課金メータ計上・delivered:true', async () => {
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: true })
    // 送信先はグループの external_group_id、本文は summary + artifactUrl。
    // retryKey は event_id を UUID 形状へ整形した値(LINE の X-Line-Retry-Key は UUID 必須)。
    const expectedKey = toLineRetryKey('evt-99')
    expect(expectedKey).toMatch(UUID_RE)
    expect(pushLineMessage).toHaveBeenCalledWith({
      accessToken: 'tok-abc',
      to: EXTERNAL_GROUP,
      messages: [{ type: 'text', text: '発注を完了しました\nhttps://example.com/a' }],
      retryKey: expectedKey,
    })
    // 生の ULID event_id をそのまま渡していない(LINE 400 回帰の防止)
    expect(pushLineMessage.mock.calls[0][0].retryKey).not.toBe('evt-99')
    // org account はグローバル予算層を参照しない
    expect(getPlatformBudgetState).not.toHaveBeenCalled()
    // 課金メータ: billablePush=true, group宛, dedupeキー=retryKey(UUID形状)
    expect(insertChannelMessage).toHaveBeenCalledTimes(1)
    expect(insertChannelMessage.mock.calls[0][0]).toMatchObject({
      orgId: ORG,
      accountId: ACCOUNT,
      groupId: GROUP,
      channel: 'line',
      direction: 'outbound',
      externalUserId: null,
      externalMessageId: expectedKey,
      billablePush: true,
      status: 'sent',
    })
  })

  it('org mismatch(digest行と group の org 不一致)は送らない(delivered:false・テナンシー防御)', async () => {
    findChatOriginGroupForTask.mockResolvedValue({ groupId: GROUP, orgId: 'org-OTHER' })
    findGroupById.mockResolvedValue(activeGroup({ orgId: ORG }))
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
    expect(insertChannelMessage).not.toHaveBeenCalled()
  })

  it('push 成功後に課金メータ insert が失敗しても delivered:true(送信済みは覆さない)', async () => {
    insertChannelMessage.mockRejectedValue(new Error('db down'))
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: true })
    expect(pushLineMessage).toHaveBeenCalledTimes(1)
  })

  it('platform account: グローバル予算層を参照し ok なら送る', async () => {
    findLineAccountById.mockResolvedValue(orgAccount({ ownerType: 'platform', orgId: null }))
    getPlatformBudgetState.mockResolvedValue('ok')
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: true })
    expect(getPlatformBudgetState).toHaveBeenCalledWith(ACCOUNT)
    expect(pushLineMessage).toHaveBeenCalled()
  })

  it('platform account: グローバル予算 hard は org方針に依らず suppress(delivered:false・非課金)', async () => {
    findLineAccountById.mockResolvedValue(orgAccount({ ownerType: 'platform', orgId: null }))
    getPlatformBudgetState.mockResolvedValue('hard')
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
    expect(insertChannelMessage).not.toHaveBeenCalled()
  })

  it('org層 block(hard/block)なら suppress(delivered:false)', async () => {
    getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })
    const r = await lineChatReplySender(payload())
    expect(r).toEqual({ delivered: false })
    expect(pushLineMessage).not.toHaveBeenCalled()
  })

  it('summary が null なら既定文で送る', async () => {
    const r = await lineChatReplySender(payload({ summary: null, artifactUrl: null }))
    expect(r).toEqual({ delivered: true })
    expect(pushLineMessage.mock.calls[0][0].messages[0].text).toBe('AI依頼が完了しました。')
  })

  it('idempotencyKey が無ければタスク基準の決定的 retryKey(UUID形状)を使う', async () => {
    const r = await lineChatReplySender(payload({ idempotencyKey: null }))
    expect(r).toEqual({ delivered: true })
    const expectedKey = toLineRetryKey('connector-completion:task-1')
    expect(expectedKey).toMatch(UUID_RE)
    expect(pushLineMessage.mock.calls[0][0].retryKey).toBe(expectedKey)
    // push と課金メータで同一キー(決定的)→ HTTP 二重送信・二重計上の両方を防ぐ
    expect(insertChannelMessage.mock.calls[0][0].externalMessageId).toBe(expectedKey)
  })
})

describe('buildCompletionReplyText', () => {
  it('summary+artifactUrl を改行で連結', () => {
    expect(buildCompletionReplyText('done', 'https://x')).toBe('done\nhttps://x')
  })
  it('summary 空白のみ→既定文, artifactUrl なし→URL付けない', () => {
    expect(buildCompletionReplyText('   ', null)).toBe('AI依頼が完了しました。')
  })
})

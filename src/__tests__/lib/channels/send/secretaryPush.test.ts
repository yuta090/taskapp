import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * sendSecretaryPush — 統一送信境界（設計正本 §9・PR-0.5）
 *
 * approval-notify（正典 src/app/api/cron/approval-notify/route.ts 76-139行）の
 * 送信/メータリング部を一般化したもの。二層予算判定
 * （org層 org_channel_policy ＋ platform account のみ グローバル層 platform_channel_budget）
 * を通過したときだけ push し、成功後に billable_push:true で outbound 記録を残す。
 *
 * entitlement（機能フラグ）の再確認はこの境界に含まない（呼び出し側の責務）ため、
 * ここではテストしない。
 */

const storeMock = {
  getOrgChannelPolicyState: vi.fn(),
  getPlatformBudgetState: vi.fn(),
  insertChannelMessage: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const pushMock = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...args: unknown[]) => pushMock(...args),
}))

const { sendSecretaryPush } = await import('@/lib/channels/send/secretaryPush')

const ORG_ACCOUNT = { id: 'acc-org-1', ownerType: 'org' as const, accessToken: 'token-org' }
const PLATFORM_ACCOUNT = { id: 'acc-shared-1', ownerType: 'platform' as const, accessToken: 'token-shared' }

function baseInput(over: Partial<Parameters<typeof sendSecretaryPush>[0]> = {}) {
  return {
    account: ORG_ACCOUNT,
    orgId: 'org-1',
    to: 'Uapprover',
    messages: [{ type: 'text' as const, text: 'hello' }],
    retryKey: 'retry-key-1',
    jstDayOfYear: 200,
    record: {
      spaceId: 'space-1',
      identityId: null,
      groupId: null,
      externalUserId: 'Uapprover',
      body: 'hello',
      payload: {},
    },
    ...over,
  }
}

describe('sendSecretaryPush（統一送信境界）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
    storeMock.getPlatformBudgetState.mockResolvedValue('ok')
    storeMock.insertChannelMessage.mockResolvedValue({ id: 'outbound-1' })
    pushMock.mockResolvedValue(undefined)
  })

  it('(a) org層 hard+block 抑止 → push されず outbound 記録もせず {delivered:false, reason}', async () => {
    storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })

    const result = await sendSecretaryPush(baseInput())

    expect(result).toEqual({ delivered: false, reason: 'quota_block_suppress' })
    expect(pushMock).not.toHaveBeenCalled()
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('(b) platform account のグローバル層 hard 抑止 → push されず outbound 記録もせず {delivered:false, reason}', async () => {
    storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
    storeMock.getPlatformBudgetState.mockResolvedValue('hard')

    const result = await sendSecretaryPush(baseInput({ account: PLATFORM_ACCOUNT }))

    expect(result).toEqual({ delivered: false, reason: 'global_budget_hard_suppress' })
    expect(storeMock.getPlatformBudgetState).toHaveBeenCalledWith('acc-shared-1')
    expect(pushMock).not.toHaveBeenCalled()
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('(c) 配信 → pushLineMessage 1回＋insertChannelMessage(billablePush:true, externalMessageId=retryKey) 1回＋{delivered:true}', async () => {
    const result = await sendSecretaryPush(baseInput())

    expect(result).toEqual({ delivered: true })
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith({
      accessToken: 'token-org',
      to: 'Uapprover',
      messages: [{ type: 'text', text: 'hello' }],
      retryKey: 'retry-key-1',
    })
    expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        direction: 'outbound',
        actor: 'secretary',
        channel: 'line',
        accountId: 'acc-org-1',
        externalMessageId: 'retry-key-1',
        billablePush: true,
        status: 'sent',
      }),
    )
  })

  it('(d) org専有bot(ownerType=org)は globalState を参照せず常に ok 扱い（getPlatformBudgetState を呼ばない）', async () => {
    storeMock.getPlatformBudgetState.mockResolvedValue('hard') // 呼ばれれば抑止されるはずの値

    const result = await sendSecretaryPush(baseInput({ account: ORG_ACCOUNT }))

    expect(result).toEqual({ delivered: true })
    expect(storeMock.getPlatformBudgetState).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('record の spaceId/identityId/groupId/externalUserId/body/payload が insertChannelMessage にそのまま渡る', async () => {
    await sendSecretaryPush(
      baseInput({
        record: {
          spaceId: 'space-9',
          identityId: 'identity-9',
          groupId: 'group-9',
          externalUserId: null,
          body: 'タスクのリマインドです',
          payload: { kind: 'task-reminder', taskId: 'task-9' },
        },
      }),
    )

    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-9',
        identityId: 'identity-9',
        groupId: 'group-9',
        externalUserId: null,
        body: 'タスクのリマインドです',
        payload: { kind: 'task-reminder', taskId: 'task-9' },
      }),
    )
  })
})

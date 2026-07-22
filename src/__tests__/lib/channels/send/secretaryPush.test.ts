import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * sendSecretaryPush — 統一送信境界（設計正本 §9・PR-0.5／マルチチャネル化 PR1）
 *
 * approval-notify（正典 src/app/api/cron/approval-notify/route.ts 76-139行）の
 * 送信/メータリング部を一般化したもの。唯一のチャネル対応秘書送信境界であり、LINEも
 * 非LINEも必ずここを通り、実送信は deliverToChannel（各チャネルのアダプタ）に委譲する。
 *
 * 予算判定（org層 org_channel_policy ＋ platform account のみ グローバル層
 * platform_channel_budget）は channel==='line' のときだけ行う。非LINEは事務所自身の
 * アカウントで送るため当社の持ち出しが無く、判定を通らず必ず配信する。
 *
 * entitlement（機能フラグ）の再確認はこの境界に含まない（呼び出し側の責務）ため、
 * ここではテストしない。
 *
 * LINEはdeliverToChannel→lineAdapter（実コード）→pushLineMessage（モック）を通す実配線で
 * 検証する（送信バイト列が変わっていないことの確認を兼ねる）。非LINEはchatwork/discordを
 * deliverToChannel（実コード）→fetch（stub）で検証する。
 */

const storeMock = {
  getOrgChannelPolicyState: vi.fn(),
  getPlatformBudgetState: vi.fn(),
  insertChannelMessage: vi.fn(),
  findOutboundMessageByExternalId: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const pushMock = vi.fn()
vi.mock('@/lib/channels/line/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/channels/line/client')>()
  return {
    ...actual,
    pushLineMessage: (...args: unknown[]) => pushMock(...args),
  }
})

const { sendSecretaryPush } = await import('@/lib/channels/send/secretaryPush')

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return fn
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ORG_ACCOUNT = { id: 'acc-org-1', ownerType: 'org' as const, accessToken: 'token-org' }
const PLATFORM_ACCOUNT = { id: 'acc-shared-1', ownerType: 'platform' as const, accessToken: 'token-shared' }

function baseInput(over: Partial<Parameters<typeof sendSecretaryPush>[0]> = {}) {
  return {
    account: ORG_ACCOUNT,
    orgId: 'org-1',
    to: 'Uapprover',
    text: 'hello',
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
    storeMock.findOutboundMessageByExternalId.mockResolvedValue(null)
    pushMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('LINE（channel省略=既存呼び出し元の後方互換）', () => {
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

    it('(c) 配信 → pushLineMessage 1回＋insertChannelMessage(billablePush:true, channel:line, externalMessageId=retryKey) 1回＋{delivered:true}', async () => {
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
          payload: {},
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

    it('LINEはpushLineMessageがexternalMessageIdを返さないため provider_message_id を payload に載せない', async () => {
      await sendSecretaryPush(baseInput({ record: { ...baseInput().record, payload: { kind: 'digest' } } }))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { kind: 'digest' } }),
      )
    })

    it('LINEは非LINE専用の二重送信チェック(findOutboundMessageByExternalId)を呼ばない（既存のLINE側dedupeに委ねる）', async () => {
      await sendSecretaryPush(baseInput())
      expect(storeMock.findOutboundMessageByExternalId).not.toHaveBeenCalled()
    })
  })

  describe('非LINE（chatwork/discord。account.channelを明示）', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function chatworkInput(over: Partial<Parameters<typeof sendSecretaryPush>[0]> = {}) {
      return baseInput({
        account: {
          id: 'acc-chatwork-1',
          ownerType: 'org' as const,
          channel: 'chatwork',
          credentials: { api_token: 'cw-token' },
        },
        to: '12345',
        text: '請求書のご確認をお願いします',
        messages: undefined,
        ...over,
      })
    }

    it('境界値: org層hard×blockでも予算判定を一切通らず必ず配信される（getOrgChannelPolicyState/getPlatformBudgetStateを呼ばない）', async () => {
      storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })
      storeMock.getPlatformBudgetState.mockResolvedValue('hard')
      mockFetch(() => jsonResponse(200, { message_id: '9' }))

      const result = await sendSecretaryPush(chatworkInput())

      expect(result).toEqual({ delivered: true })
      expect(storeMock.getOrgChannelPolicyState).not.toHaveBeenCalled()
      expect(storeMock.getPlatformBudgetState).not.toHaveBeenCalled()
    })

    it('deliverToChannel経由(実chatworkAdapter)で配信され、billable_push:false・channel:chatworkで記録される', async () => {
      const fetchFn = mockFetch(() => jsonResponse(200, { message_id: '9' }))

      const result = await sendSecretaryPush(chatworkInput())

      expect(result).toEqual({ delivered: true })
      const [url] = fetchFn.mock.calls[0]
      expect(url).toContain('/rooms/12345/messages')
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'chatwork',
          accountId: 'acc-chatwork-1',
          billablePush: false,
          status: 'sent',
        }),
      )
    })

    it('アダプタが返した externalMessageId は payload.provider_message_id に載る', async () => {
      mockFetch(() => jsonResponse(200, { message_id: 'cw-msg-9' }))

      await sendSecretaryPush(chatworkInput({ record: { ...chatworkInput().record, payload: { kind: 'digest' } } }))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { kind: 'digest', provider_message_id: 'cw-msg-9' },
        }),
      )
    })

    it('アダプタがexternalMessageIdを返さない場合(discordのwebhook)はpayloadに provider_message_id を足さない', async () => {
      mockFetch(() => new Response(null, { status: 204 }))

      await sendSecretaryPush(
        chatworkInput({
          account: {
            id: 'acc-discord-1',
            ownerType: 'org' as const,
            channel: 'discord',
            credentials: { webhook_url: 'https://discord.com/api/webhooks/1/abc' },
          },
          record: { ...chatworkInput().record, payload: { kind: 'digest' } },
        }),
      )

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { kind: 'digest' } }),
      )
    })

    it('同一(account, retryKey)のoutbound記録が既にあれば送信せず {delivered:false, reason:already_delivered} を返す', async () => {
      storeMock.findOutboundMessageByExternalId.mockResolvedValue({ id: 'existing-outbound-1' })
      const fetchFn = mockFetch(() => jsonResponse(200, { message_id: '9' }))

      const result = await sendSecretaryPush(chatworkInput())

      expect(result).toEqual({ delivered: false, reason: 'already_delivered' })
      expect(storeMock.findOutboundMessageByExternalId).toHaveBeenCalledWith('acc-chatwork-1', 'retry-key-1')
      expect(fetchFn).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('アダプタが ok:false を返したら throw する（呼び出し側の既存catchでerrorsに積む契約）', async () => {
      mockFetch(() => jsonResponse(401, { error: 'invalid token' }))

      await expect(sendSecretaryPush(chatworkInput())).rejects.toThrow(/channel=chatwork/)
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('未対応チャネル(email)はdeliverToChannelがpermanent失敗を返し throw する', async () => {
      await expect(
        sendSecretaryPush(
          chatworkInput({
            account: { id: 'acc-x', ownerType: 'org' as const, channel: 'email', credentials: {} },
          }),
        ),
      ).rejects.toThrow()
    })
  })
})

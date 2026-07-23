import { describe, it, expect, vi } from 'vitest'
import {
  handleGoogleChatIngest,
  type GoogleChatIngestDeps,
  type PubSubPushBody,
  type ChatCloudEvent,
  type ChatMessageResource,
} from '@/lib/channels/google-chat/ingestHandler'
import { buildDigestDoneText, ALREADY_DONE_TEXT } from '@/lib/channels/claimLimboCore'

const ACCOUNT = { id: 'acc-gchat-plat' }
const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

function encodeCloudEvent(event: ChatCloudEvent): PubSubPushBody {
  const json = JSON.stringify(event)
  return {
    message: {
      data: Buffer.from(json, 'utf-8').toString('base64'),
      messageId: 'pubsub-msg-1',
    },
    subscription: 'projects/p/subscriptions/s',
  }
}

function messageCreatedEvent(over: Partial<ChatMessageResource> = {}): PubSubPushBody {
  const message: ChatMessageResource = {
    name: 'spaces/S1/messages/M1',
    space: { name: 'spaces/S1' },
    sender: { name: 'users/U1', type: 'HUMAN' },
    text: 'こんにちは',
    createTime: '2026-07-20T00:00:00.000Z',
    ...over,
  }
  return encodeCloudEvent({
    type: 'google.workspace.chat.message.v1.created',
    data: { message },
  })
}

function makeDeps(over: Partial<GoogleChatIngestDeps> = {}): GoogleChatIngestDeps {
  return {
    loadPlatformAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findActiveGroup: vi.fn().mockResolvedValue(null),
    insertMessage: vi.fn().mockResolvedValue({ id: 'row-1' }),
    completeDigestTask: vi.fn().mockResolvedValue(null),
    reply: vi.fn().mockResolvedValue({ providerMessageId: 'spaces/S1/messages/M-out-1' }),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    findSubscriptionByResourceName: vi.fn().mockResolvedValue(null),
    markSubscriptionStatus: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

describe('handleGoogleChatIngest — message.created・claimed', () => {
  it('active groupがあればgroup.org/spaceで記録する（externalMessageId=message.name）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    const res = await handleGoogleChatIngest(messageCreatedEvent(), deps)
    expect(res).toEqual({ status: 200 })
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      spaceId: 'space-1',
      accountId: 'acc-gchat-plat',
      groupId: 'grp-1',
      channel: 'google_chat',
      direction: 'inbound',
      actor: 'client',
      externalUserId: 'users/U1',
      externalMessageId: 'spaces/S1/messages/M1',
      body: 'こんにちは',
      occurredAt: '2026-07-20T00:00:00.000Z',
    })
  })

  it('createTime欠落/不正はepochにフォールバックする', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleGoogleChatIngest(messageCreatedEvent({ createTime: undefined }), deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.occurredAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('sender.type=BOTは無視する（記録0）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleGoogleChatIngest(
      messageCreatedEvent({ sender: { name: 'users/BOT1', type: 'BOT' } }),
      deps,
    )
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('同一message.nameの再送(duplicate)は完了処理を呼ばない', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      completeDigestTask,
    })
    await handleGoogleChatIngest(messageCreatedEvent({ text: '完了2' }), deps)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

describe('handleGoogleChatIngest — 完了コマンド（claimed経路限定）', () => {
  it('claimedグループの「完了2」で完了しsendChatMessageで返信・outbound記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-2', title: '請求書の発行' })
    const reply = vi.fn().mockResolvedValue({ providerMessageId: 'spaces/S1/messages/M-out-2' })
    const insertOutbound = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
      reply,
      insertOutbound,
    })
    await handleGoogleChatIngest(messageCreatedEvent({ text: '完了2' }), deps)

    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 2, 'users/U1')
    expect(reply).toHaveBeenCalledWith('spaces/S1', buildDigestDoneText('請求書の発行'))
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        groupId: 'grp-1',
        channel: 'google_chat',
        direction: 'outbound',
        actor: 'secretary',
        body: buildDigestDoneText('請求書の発行'),
        status: 'sent',
      }),
    )
  })

  it('既に完了済み(該当タスク無し)はALREADY_DONE_TEXTで返信する', async () => {
    const reply = vi.fn().mockResolvedValue({ providerMessageId: null })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask: vi.fn().mockResolvedValue(null),
      reply,
    })
    await handleGoogleChatIngest(messageCreatedEvent({ text: '完了2' }), deps)
    expect(reply).toHaveBeenCalledWith('spaces/S1', ALREADY_DONE_TEXT)
  })

  it('自Bot宛メンション「@Bot 完了2」はannotationsで剥がして発火する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), completeDigestTask })
    await handleGoogleChatIngest(
      messageCreatedEvent({
        text: '@Bot 完了2',
        annotations: [
          {
            type: 'USER_MENTION',
            startIndex: 0,
            length: 4, // '@Bot'
            userMention: { user: { name: 'users/BOT1', type: 'BOT' } },
          },
        ],
      }),
      deps,
    )
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 2, 'users/U1')
  })

  it('他人(HUMAN)宛メンションは剥がさず発火しない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), completeDigestTask })
    await handleGoogleChatIngest(
      messageCreatedEvent({
        text: '@田中さん 完了2',
        annotations: [
          {
            type: 'USER_MENTION',
            startIndex: 0,
            length: 6,
            userMention: { user: { name: 'users/U2', type: 'HUMAN' } },
          },
        ],
      }),
      deps,
    )
    expect(completeDigestTask).not.toHaveBeenCalled()
  })

  it('メンション付き自然文では発火しない（誤爆防止・記録はされる）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), completeDigestTask })
    await handleGoogleChatIngest(
      messageCreatedEvent({
        text: '@Bot あの件は完了しました',
        annotations: [
          {
            type: 'USER_MENTION',
            startIndex: 0,
            length: 4,
            userMention: { user: { name: 'users/BOT1', type: 'BOT' } },
          },
        ],
      }),
      deps,
    )
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.insertMessage).toHaveBeenCalled()
  })

  it('annotations無しの素の「完了2」は発火する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), completeDigestTask })
    await handleGoogleChatIngest(messageCreatedEvent({ text: '完了2', annotations: undefined }), deps)
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 2, 'users/U1')
  })

  it('未claim(limbo)グループでは「完了2」を送っても完了処理・記録・返信も一切起きない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(null), completeDigestTask })
    const res = await handleGoogleChatIngest(messageCreatedEvent({ text: '完了2' }), deps)
    expect(res).toEqual({ status: 200 })
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

describe('handleGoogleChatIngest — platformアカウント無し', () => {
  it('共有アカウント未設定は無処理(200)', async () => {
    const deps = makeDeps({
      loadPlatformAccount: vi.fn().mockResolvedValue(null),
      findActiveGroup: vi.fn(),
    })
    const res = await handleGoogleChatIngest(messageCreatedEvent(), deps)
    expect(res).toEqual({ status: 200 })
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

describe('handleGoogleChatIngest — subscription lifecycle', () => {
  it('subscription.v1.expired: 該当購読を expired にする', async () => {
    const markSubscriptionStatus = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findSubscriptionByResourceName: vi.fn().mockResolvedValue({ id: 'sub-row-1' }),
      markSubscriptionStatus,
    })
    const body = encodeCloudEvent({
      type: 'google.workspace.subscription.v1.expired',
      data: { subscription: { name: 'subscriptions/AAA' } },
    })
    const res = await handleGoogleChatIngest(body, deps)
    expect(res).toEqual({ status: 200 })
    expect(deps.findSubscriptionByResourceName).toHaveBeenCalledWith('subscriptions/AAA')
    expect(markSubscriptionStatus).toHaveBeenCalledWith('sub-row-1', 'expired')
  })

  it('subscription.v1.expired: 該当購読が見つからなければ何もしない', async () => {
    const markSubscriptionStatus = vi.fn()
    const deps = makeDeps({
      findSubscriptionByResourceName: vi.fn().mockResolvedValue(null),
      markSubscriptionStatus,
    })
    const body = encodeCloudEvent({
      type: 'google.workspace.subscription.v1.expired',
      data: { subscription: { name: 'subscriptions/UNKNOWN' } },
    })
    await handleGoogleChatIngest(body, deps)
    expect(markSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('subscription.v1.expirationReminder はno-op（購読更新はcron側）', async () => {
    const deps = makeDeps()
    const body = encodeCloudEvent({
      type: 'google.workspace.subscription.v1.expirationReminder',
      data: { subscription: { name: 'subscriptions/AAA' } },
    })
    const res = await handleGoogleChatIngest(body, deps)
    expect(res).toEqual({ status: 200 })
    expect(deps.markSubscriptionStatus).not.toHaveBeenCalled()
    expect(deps.loadPlatformAccount).not.toHaveBeenCalled()
  })
})

describe('handleGoogleChatIngest — 異常系', () => {
  it('data欠落(base64なし)は無処理200', async () => {
    const deps = makeDeps()
    const res = await handleGoogleChatIngest({ message: {}, subscription: 's' }, deps)
    expect(res).toEqual({ status: 200 })
    expect(deps.loadPlatformAccount).not.toHaveBeenCalled()
  })

  it('base64デコード後がJSONでない/typeが無いものは無処理200', async () => {
    const deps = makeDeps()
    const res = await handleGoogleChatIngest(
      { message: { data: Buffer.from('not json', 'utf-8').toString('base64') } },
      deps,
    )
    expect(res).toEqual({ status: 200 })
    expect(deps.loadPlatformAccount).not.toHaveBeenCalled()
  })

  it('未知のtypeは無処理200', async () => {
    const deps = makeDeps()
    const body = encodeCloudEvent({ type: 'google.workspace.chat.membership.v1.created' })
    const res = await handleGoogleChatIngest(body, deps)
    expect(res).toEqual({ status: 200 })
    expect(deps.loadPlatformAccount).not.toHaveBeenCalled()
  })

  it('message/space.name欠落は無処理200（記録0）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    const body = encodeCloudEvent({
      type: 'google.workspace.chat.message.v1.created',
      data: { message: { name: 'spaces/S1/messages/M1' } }, // space無し
    })
    await handleGoogleChatIngest(body, deps)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('1件のDB例外は握って200を返す（他イベントを巻き込まない設計と同じ骨格）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage: vi.fn().mockRejectedValue(new Error('db boom')),
    })
    const res = await handleGoogleChatIngest(messageCreatedEvent(), deps)
    expect(res).toEqual({ status: 200 })
  })
})

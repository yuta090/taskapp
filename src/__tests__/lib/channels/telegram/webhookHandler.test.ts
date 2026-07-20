import { describe, it, expect, vi } from 'vitest'
import { handleTelegramWebhook, type TelegramWebhookDeps } from '@/lib/channels/telegram/webhookHandler'

const ACCOUNT = {
  id: 'acc-tg-1',
  channel: 'telegram',
  orgId: 'org-1',
  ownerType: 'org' as const,
  status: 'active' as const,
  credentials: { bot_token: '123:AAbb', webhook_secret: 'sekret' },
}

function textUpdate(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    update_id: 555,
    message: {
      message_id: 42,
      from: { id: 9001, first_name: 'Taro' },
      chat: { id: 9001, type: 'private' },
      date: 1_700_000_000,
      text: 'こんにちは',
      ...overrides,
    },
  })
}

function makeDeps(over: Partial<TelegramWebhookDeps> = {}): TelegramWebhookDeps {
  return {
    loadAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findIdentities: vi.fn().mockResolvedValue([]),
    insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    ...over,
  }
}

describe('handleTelegramWebhook', () => {
  it('secret_token 不一致は401で何も書かない', async () => {
    const deps = makeDeps()
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate(), 'WRONG', deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('未知アカウントは401（存在秘匿・記録しない）', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const res = await handleTelegramWebhook('nope', textUpdate(), 'sekret', deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('platformアカウントは非対応(400)。org解決不能なため記録しない', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, ownerType: 'platform', orgId: null }),
    })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    expect(res.status).toBe(400)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('正当な受信: identity 0件は space/identity null で triage 記録し 200', async () => {
    const deps = makeDeps()
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      channel: 'telegram',
      direction: 'inbound',
      actor: 'client',
      spaceId: null,
      identityId: null,
      externalUserId: '9001',
      body: 'こんにちは',
      accountId: 'acc-tg-1',
    })
    // dedupe キーは chat_id:message_id
    expect(arg.externalMessageId).toBe('9001:42')
  })

  it('identity がちょうど1件なら space/identity を確定', async () => {
    const deps = makeDeps({
      findIdentities: vi.fn().mockResolvedValue([{ id: 'idn-1', spaceId: 'space-1' }]),
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'space-1', identityId: 'idn-1' })
  })

  it('identity が複数なら人力トリアージ（null記録）', async () => {
    const deps = makeDeps({
      findIdentities: vi
        .fn()
        .mockResolvedValue([{ id: 'a', spaceId: 's1' }, { id: 'b', spaceId: 's2' }]),
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: null, identityId: null })
  })

  it('メッセージを含まない更新(edited等)は200 ignoredで記録しない', async () => {
    const deps = makeDeps()
    const res = await handleTelegramWebhook(
      'acc-tg-1',
      JSON.stringify({ update_id: 1, edited_message: { message_id: 1 } }),
      'sekret',
      deps,
    )
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('不正JSONは200（再送ループ回避）で記録しない', async () => {
    const deps = makeDeps()
    const res = await handleTelegramWebhook('acc-tg-1', '{bad', 'sekret', deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('重複(insertMessageがduplicate)でも200', async () => {
    const deps = makeDeps({ insertMessage: vi.fn().mockResolvedValue('duplicate') })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    expect(res.status).toBe(200)
  })
})

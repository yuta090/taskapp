import { describe, it, expect, vi } from 'vitest'
import {
  handleDiscordIngest,
  buildAcceptedText,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  type DiscordIngestDeps,
  type DiscordIngestEvent,
} from '@/lib/channels/discord/ingestHandler'

const ACCOUNT = { id: 'acc-discord-plat', botToken: 'bot-token' }

function event(over: Partial<DiscordIngestEvent> = {}): DiscordIngestEvent {
  return {
    type: 'message_create',
    guildId: 'G1',
    channelId: 'C1',
    messageId: 'M1',
    author: { id: 'U1', isBot: false, displayName: '客先' },
    content: 'こんにちは',
    timestamp: '2026-07-20T00:00:00.000Z',
    ...over,
  }
}

function makeDeps(over: Partial<DiscordIngestDeps> = {}): DiscordIngestDeps {
  return {
    loadPlatformAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findActiveGroup: vi.fn().mockResolvedValue(null),
    insertMessage: vi.fn().mockResolvedValue({ id: 'x' }),
    normalizeClaimCode: vi.fn().mockReturnValue(null),
    hashClaimCode: vi.fn((c: string) => `hash(${c})`),
    findValidClaimCode: vi.fn().mockResolvedValue(null),
    hasExternalChatChannels: vi.fn().mockResolvedValue(true),
    externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 0, max: 50 }),
    createPendingClaim: vi.fn().mockResolvedValue({ challengeLabel: 'AB12' }),
    redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    generateChallengeLabel: vi.fn().mockReturnValue('AB12'),
    registerInvalidAttempt: vi.fn().mockReturnValue(false),
    reply: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

describe('handleDiscordIngest — claimed チャンネル', () => {
  it('active group があれば group.org/space で記録（bindingゲートは無し＝既存は切らない）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    const res = await handleDiscordIngest([event()], deps)
    expect(res.inserted).toBe(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      spaceId: 'space-1',
      groupId: 'grp-1',
      channel: 'discord',
      direction: 'inbound',
      actor: 'client',
      externalUserId: 'U1',
      externalMessageId: 'M1',
      body: 'こんにちは',
    })
    expect(deps.hasExternalChatChannels).not.toHaveBeenCalled()
  })

  it('dedupe(duplicate)は inserted に数えない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'g', orgId: 'o', spaceId: null }),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
    })
    const res = await handleDiscordIngest([event()], deps)
    expect(res.inserted).toBe(0)
  })

  it('bot 発言は取り込まない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'g', orgId: 'o', spaceId: null }),
    })
    const res = await handleDiscordIngest([event({ author: { id: 'B', isBot: true } })], deps)
    expect(res.processed).toBe(0)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('共有Bot未設定(loadPlatformAccount=null)は何もしない', async () => {
    const deps = makeDeps({ loadPlatformAccount: vi.fn().mockResolvedValue(null) })
    const res = await handleDiscordIngest([event()], deps)
    expect(res).toEqual({ processed: 0, inserted: 0, claimsCreated: 0 })
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })
})

describe('handleDiscordIngest — limbo（未claim）', () => {
  it('コード形状でない通常発言は完全沈黙（無保存・無返信）', async () => {
    const deps = makeDeps({ normalizeClaimCode: vi.fn().mockReturnValue(null) })
    const res = await handleDiscordIngest([event()], deps)
    expect(res.inserted).toBe(0)
    expect(res.claimsCreated).toBe(0)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('コード不一致は固定文言を返信（レート未超過）', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    await handleDiscordIngest([event({ content: 'GC-XXXX' })], deps)
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', INVALID_TEXT)
  })

  it('コード不一致でもレート超過後は無返信（content-free）', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    await handleDiscordIngest([event({ content: 'GC-XXXX' })], deps)
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('web_approval 有効コード×Pro: pending claim 作成＋確認番号返信', async () => {
    const createPendingClaim = vi.fn().mockResolvedValue({ challengeLabel: 'AB12' })
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      createPendingClaim,
    })
    const res = await handleDiscordIngest([event({ content: 'GC-CODE' })], deps)
    expect(res.claimsCreated).toBe(1)
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-discord-plat',
        externalGroupId: 'C1',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', buildAcceptedText('AB12'))
    expect(deps.insertMessage).not.toHaveBeenCalled() // 承認前は保存0行
  })

  it('code_only 有効コード×Pro: 即時償還して結果文言', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    })
    const res = await handleDiscordIngest([event({ content: 'GC-CODE' })], deps)
    expect(res.claimsCreated).toBe(1)
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith('hash(CODE26)', 'acc-discord-plat', 'C1', null)
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', CODE_ONLY_LINKED_TEXT)
  })

  it('Proゲート: external_chat_channels 不所持なら確立させず無効文言（漏らさない）', async () => {
    const createPendingClaim = vi.fn()
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-free',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      hasExternalChatChannels: vi.fn().mockResolvedValue(false),
      createPendingClaim,
    })
    const res = await handleDiscordIngest([event({ content: 'GC-CODE' })], deps)
    expect(res.claimsCreated).toBe(0)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', INVALID_TEXT)
  })

  it('上限超過(maxExternalChatGroups)なら確立させず無効文言', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 50, max: 50 }),
      createPendingClaim: vi.fn(),
    })
    const res = await handleDiscordIngest([event({ content: 'GC-CODE' })], deps)
    expect(res.claimsCreated).toBe(0)
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', INVALID_TEXT)
  })

  it('enterprise(max=null)は上限で弾かれない', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 999, max: null }),
    })
    const res = await handleDiscordIngest([event({ content: 'GC-CODE' })], deps)
    expect(res.claimsCreated).toBe(1)
  })
})

describe('handleDiscordIngest — バッチ', () => {
  it('複数イベントを個別に処理する', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'g', orgId: 'o', spaceId: null }),
    })
    const res = await handleDiscordIngest([event({ messageId: 'M1' }), event({ messageId: 'M2' })], deps)
    expect(res.processed).toBe(2)
    expect(res.inserted).toBe(2)
  })

  it('1イベントがthrowしても他イベントは処理される（poison pill隔離）', async () => {
    const insertMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('db boom')) // M1 で失敗
      .mockResolvedValue({ id: 'ok' }) // M2 は成功
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'g', orgId: 'o', spaceId: null }),
      insertMessage,
    })
    const res = await handleDiscordIngest(
      [event({ messageId: 'M1' }), event({ messageId: 'M2' })],
      deps,
    )
    // 全体は throw しない。M2 は取り込まれる。
    expect(res.processed).toBe(2)
    expect(res.inserted).toBe(1)
    expect(insertMessage).toHaveBeenCalledTimes(2)
  })
})

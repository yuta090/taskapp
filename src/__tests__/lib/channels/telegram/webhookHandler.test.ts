import { describe, it, expect, vi } from 'vitest'
import {
  handleTelegramWebhook,
  buildAcceptedText,
  buildDigestDoneText,
  ALREADY_DONE_TEXT,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  type TelegramWebhookDeps,
  type TelegramAccount,
} from '@/lib/channels/telegram/webhookHandler'

const ACCOUNT: TelegramAccount = {
  id: 'acc-tg-1',
  channel: 'telegram',
  orgId: 'org-1',
  ownerType: 'org',
  status: 'active',
  credentials: { bot_token: '123:AAbb', webhook_secret: 'sekret' },
}

function textUpdate(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    update_id: 555,
    message: {
      message_id: 42,
      from: { id: 9001, first_name: 'Taro', is_bot: false },
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
    findActiveGroup: vi.fn().mockResolvedValue(null),
    insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    normalizeClaimCode: vi.fn().mockReturnValue(null),
    hashClaimCode: vi.fn((c: string) => `hash(${c})`),
    findValidClaimCode: vi.fn().mockResolvedValue(null),
    hasExternalChatChannels: vi.fn().mockResolvedValue(true),
    externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 0, max: 50 }),
    createPendingClaim: vi.fn().mockResolvedValue({ challengeLabel: 'AB12' }),
    redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    generateChallengeLabel: vi.fn().mockReturnValue('AB12'),
    registerInvalidAttempt: vi.fn().mockReturnValue(false),
    reply: vi.fn().mockResolvedValue({ messageId: '9999' }),
    completeDigestTask: vi.fn().mockResolvedValue(null),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 凍結(characterization): secret_token照合・platform拒否・JSONパース失敗・
// メッセージ不成立フィルタは改修前後で不変。
// ---------------------------------------------------------------------------

describe('handleTelegramWebhook — 認証・形状フィルタ（凍結）', () => {
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

  it('from.is_bot:true は200 ignoredで記録しない（他Bot・自Botの多層防御）', async () => {
    const deps = makeDeps()
    const res = await handleTelegramWebhook(
      'acc-tg-1',
      textUpdate({ from: { id: 555, is_bot: true } }),
      'sekret',
      deps,
    )
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// claimed チャット
// ---------------------------------------------------------------------------

describe('handleTelegramWebhook — claimed チャット', () => {
  it('active group があれば group_id 付きで記録し、通常発言は返信しない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      spaceId: 'space-1',
      groupId: 'grp-1',
      identityId: null,
      channel: 'telegram',
      direction: 'inbound',
      actor: 'client',
      externalUserId: '9001',
      body: 'こんにちは',
      accountId: 'acc-tg-1',
      contentType: 'text',
    })
    // dedupe キーは chat_id:message_id
    expect(arg.externalMessageId).toBe('9001:42')
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.hasExternalChatChannels).not.toHaveBeenCalled()
  })

  it('同一chat:message_idの再送(duplicate)は完了処理を再実行しない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      completeDigestTask,
    })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '完了2' }), 'sekret', deps)
    expect(res.status).toBe(200)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// limbo（未claim）: 沈黙不変条件・claim償還
// ---------------------------------------------------------------------------

describe('handleTelegramWebhook — limbo（未claim）', () => {
  it('claimコード形状でない通常発言は完全沈黙（無保存・無返信）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null),
    })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate(), 'sekret', deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('有効な code_only コード: 即時償還してLINKED文言を返信・保存はしない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-CODE' }), 'sekret', deps)
    expect(res.status).toBe(200)
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith('hash(CODE26)', 'acc-tg-1', '9001', null, 50)
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', CODE_ONLY_LINKED_TEXT)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('既に別コードで登録済みのチャットは ALREADY 文言', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('already_linked'),
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-CODE' }), 'sekret', deps)
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', CODE_ONLY_ALREADY_TEXT)
  })

  it('web_approval 有効コード: pending claim を作り確認番号入りの受理文言を返信', async () => {
    const createPendingClaim = vi.fn().mockResolvedValue({ challengeLabel: 'AB12' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      createPendingClaim,
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-CODE' }), 'sekret', deps)
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-tg-1',
        externalGroupId: '9001',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', buildAcceptedText('AB12'))
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('無効コードはINVALID文言（レート未超過）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-XXXX' }), 'sekret', deps)
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', INVALID_TEXT)
  })

  it('無効コードでもレート超過後は無返信', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-XXXX' }), 'sekret', deps)
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('Proゲート: external_chat_channels 不所持なら確立させず無効文言（漏らさない）', async () => {
    const createPendingClaim = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
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
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-CODE' }), 'sekret', deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', INVALID_TEXT)
  })

  it('容量上限超過なら確立させず無効文言', async () => {
    const createPendingClaim = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 50, max: 50 }),
      createPendingClaim,
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: 'GC-CODE' }), 'sekret', deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', INVALID_TEXT)
  })

  it('未claimチャットで「完了2」を送っても完了処理も返信も一切起きない（沈黙不変条件）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null),
      completeDigestTask,
    })
    const res = await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '完了2' }), 'sekret', deps)
    expect(res.status).toBe(200)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 完了コマンド（claimedのみ）
// ---------------------------------------------------------------------------

describe('handleTelegramWebhook — 完了コマンド（claimed経路限定）', () => {
  const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

  it('claimedチャットの「完了2」でタスクを完了し、成功文言でreply・outbound記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: '見積書の送付' })
    const insertOutbound = vi.fn().mockResolvedValue(undefined)
    const reply = vi.fn().mockResolvedValue({ messageId: '777' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
      insertOutbound,
      reply,
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '完了2' }), 'sekret', deps)

    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 2, '9001')
    expect(reply).toHaveBeenCalledWith('123:AAbb', '9001', buildDigestDoneText('見積書の送付'))
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        groupId: 'grp-1',
        channel: 'telegram',
        direction: 'outbound',
        actor: 'secretary',
        body: buildDigestDoneText('見積書の送付'),
        status: 'sent',
        payload: expect.objectContaining({ provider_message_id: '777' }),
      }),
    )
  })

  it('該当タスクが無い（既に完了済み等）場合はALREADY_DONE_TEXTでreplyする', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask: vi.fn().mockResolvedValue(null),
    })
    await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '完了2' }), 'sekret', deps)
    expect(deps.reply).toHaveBeenCalledWith('123:AAbb', '9001', ALREADY_DONE_TEXT)
  })

  describe('メンション剥がし（先頭@{bot_username}のみ・大小無視）', () => {
    it('bot自身宛「@MyBot 完了3」（botUsername一致・大小無視）は剥がして発火する', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botUsername: 'MyBot' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '@mybot 完了3' }), 'sekret', deps)
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '9001')
    })

    it('他人宛「@OtherBot 完了3」は剥がさず発火しない（厳格文法不一致）', async () => {
      const completeDigestTask = vi.fn()
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botUsername: 'MyBot' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '@OtherBot 完了3' }), 'sekret', deps)
      expect(completeDigestTask).not.toHaveBeenCalled()
      // 通常発言としては記録される（沈黙にはならない）
      expect(deps.insertMessage).toHaveBeenCalled()
    })

    it('自然文「完了しました！」は発火しない', async () => {
      const completeDigestTask = vi.fn()
      const deps = makeDeps({
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      await handleTelegramWebhook('acc-tg-1', textUpdate({ text: '完了しました！' }), 'sekret', deps)
      expect(completeDigestTask).not.toHaveBeenCalled()
      expect(deps.insertMessage).toHaveBeenCalled()
    })

    it('botUsername未設定時は無加工。素の「完了3」のみ発火し、メンション付きは発火しない', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      await handleTelegramWebhook(
        'acc-tg-1',
        textUpdate({ text: '@MyBot 完了3', message_id: 201 }),
        'sekret',
        deps,
      )
      expect(completeDigestTask).not.toHaveBeenCalled()

      await handleTelegramWebhook(
        'acc-tg-1',
        textUpdate({ text: '完了3', message_id: 202 }),
        'sekret',
        deps,
      )
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '9001')
    })
  })
})

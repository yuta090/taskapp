import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  handleChatworkWebhook,
  buildAcceptedText,
  buildDigestDoneText,
  ALREADY_DONE_TEXT,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  type ChatworkWebhookDeps,
  type ChatworkAccount,
} from '@/lib/channels/chatwork/webhookHandler'

// Chatwork Webhook v2 の webhook_token は base64 で配布される。
// 署名 = base64( HMAC-SHA256( rawBody, base64decode(webhook_token) ) )
const WEBHOOK_TOKEN = Buffer.from('chatwork-secret-key').toString('base64')

const ACCOUNT: ChatworkAccount = {
  id: 'acc-cw-1',
  channel: 'chatwork',
  orgId: 'org-1',
  ownerType: 'org',
  status: 'active',
  credentials: { api_token: 'tok', webhook_token: WEBHOOK_TOKEN },
}

function sign(rawBody: string, token = WEBHOOK_TOKEN): string {
  return createHmac('sha256', Buffer.from(token, 'base64')).update(rawBody, 'utf8').digest('base64')
}

function messageEvent(over: Record<string, unknown> = {}, type = 'message_created') {
  return JSON.stringify({
    webhook_setting_id: '99',
    webhook_event_type: type,
    webhook_event_time: 1_700_000_000,
    webhook_event: {
      message_id: '1234567890',
      room_id: 108480917,
      account_id: 363,
      body: 'テスト依頼です',
      send_time: 1_700_000_000,
      update_time: 0,
      ...over,
    },
  })
}

function makeDeps(over: Partial<ChatworkWebhookDeps> = {}): ChatworkWebhookDeps {
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
    reply: vi.fn().mockResolvedValue({ messageId: '999888' }),
    completeDigestTask: vi.fn().mockResolvedValue(null),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 凍結(characterization): 署名検証・JSON解釈・platform拒否・event形状フィルタ・
// self-loop除外は改修前後で不変。
// ---------------------------------------------------------------------------

describe('handleChatworkWebhook — 認証・event形状（凍結）', () => {
  it('署名不一致は401で何も書かない', async () => {
    const deps = makeDeps()
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, 'AAAAwrongAAAA', deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })

  it('署名ヘッダ欠如は401', async () => {
    const deps = makeDeps()
    const res = await handleChatworkWebhook('acc-cw-1', messageEvent(), null, deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('未知アカウントは401（存在秘匿・記録しない）', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const body = messageEvent()
    const res = await handleChatworkWebhook('nope', body, sign(body), deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('webhook_token 未設定のアカウントは401（検証不能）', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({
        ...ACCOUNT,
        credentials: { api_token: 'tok' },
      }),
    })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('platformアカウントは非対応(400)。org解決不能なため記録しない', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, ownerType: 'platform', orgId: null }),
    })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(400)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })

  it('mention_to_me も取り込む対象イベント型（claimed経路で記録）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    const body = messageEvent({}, 'mention_to_me')
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
  })

  it('メッセージ以外のイベント(message_deleted等)は200 ignoredで記録しない', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({
      webhook_event_type: 'message_deleted',
      webhook_event: { message_id: '1', room_id: 1, account_id: 2 },
    })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('不完全event（bodyやmessage_id欠如）は200 ignoredで記録しない', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({
      webhook_event_type: 'message_created',
      webhook_event: { room_id: 1, account_id: 2 },
    })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('不正JSONは200（再送ループ回避）で記録しない', async () => {
    const deps = makeDeps()
    // 署名は生ボディに対して検証するので、壊れたJSONでも署名は一致させる
    const res = await handleChatworkWebhook('acc-cw-1', '{bad', sign('{bad'), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('bot自身の発言(bot_account_id一致)はループ防止で無視', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botAccountId: '363' }),
    })
    const body = messageEvent({ account_id: 363 })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// claimed ルーム
// ---------------------------------------------------------------------------

describe('handleChatworkWebhook — claimed ルーム', () => {
  it('active group があれば group_id 付きで記録し、通常発言は返信しない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      spaceId: 'space-1',
      groupId: 'grp-1',
      identityId: null,
      channel: 'chatwork',
      direction: 'inbound',
      actor: 'client',
      externalUserId: '363',
      body: 'テスト依頼です',
      accountId: 'acc-cw-1',
      contentType: 'text',
    })
    // dedupe キーは room_id:message_id（room内で一意・再送で不変）
    expect(arg.externalMessageId).toBe('108480917:1234567890')
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.hasExternalChatChannels).not.toHaveBeenCalled()
  })

  it('重複(insertMessageがduplicate)でも200・完了処理は再実行しない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      completeDigestTask,
    })
    const body = messageEvent({ body: '完了2' })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// limbo（未claim）: 沈黙不変条件・claim償還
// ---------------------------------------------------------------------------

describe('handleChatworkWebhook — limbo（未claim）', () => {
  it('claimコード形状でない通常発言は完全沈黙（無保存・無返信）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null),
    })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
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
    const body = messageEvent({ body: 'GC-CODE' })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith('hash(CODE26)', 'acc-cw-1', '108480917', null, 50)
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', CODE_ONLY_LINKED_TEXT)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('既に別コードで登録済みのルームは ALREADY 文言', async () => {
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
    const body = messageEvent({ body: 'GC-CODE' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', CODE_ONLY_ALREADY_TEXT)
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
    const body = messageEvent({ body: 'GC-CODE' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-cw-1',
        externalGroupId: '108480917',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', buildAcceptedText('AB12'))
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('無効コードはINVALID文言（レート未超過）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    const body = messageEvent({ body: 'GC-XXXX' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', INVALID_TEXT)
  })

  it('無効コードでもレート超過後は無返信', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    const body = messageEvent({ body: 'GC-XXXX' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
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
    const body = messageEvent({ body: 'GC-CODE' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', INVALID_TEXT)
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
    const body = messageEvent({ body: 'GC-CODE' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', INVALID_TEXT)
  })

  it('未claimルームで「完了2」を送っても完了処理も返信も一切起きない（沈黙不変条件）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null), // コード形状でもない通常発言扱い
      completeDigestTask,
    })
    const body = messageEvent({ body: '完了2' })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 完了コマンド（claimedのみ）
// ---------------------------------------------------------------------------

describe('handleChatworkWebhook — 完了コマンド（claimed経路限定）', () => {
  const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

  it('claimedグループの「完了2」でタスクを完了し、成功文言でreply・outbound記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: '見積書の送付' })
    const insertOutbound = vi.fn().mockResolvedValue(undefined)
    const reply = vi.fn().mockResolvedValue({ messageId: '999999' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
      insertOutbound,
      reply,
    })
    const body = messageEvent({ body: '完了2' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)

    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 2, '363')
    expect(reply).toHaveBeenCalledWith('tok', '108480917', buildDigestDoneText('見積書の送付'))
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        groupId: 'grp-1',
        channel: 'chatwork',
        direction: 'outbound',
        actor: 'secretary',
        body: buildDigestDoneText('見積書の送付'),
        status: 'sent',
        payload: expect.objectContaining({ provider_message_id: '999999' }),
      }),
    )
  })

  it('該当タスクが無い（既に完了済み等）場合はALREADY_DONE_TEXTでreplyする', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask: vi.fn().mockResolvedValue(null),
    })
    const body = messageEvent({ body: '完了2' })
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(deps.reply).toHaveBeenCalledWith('tok', '108480917', ALREADY_DONE_TEXT)
  })

  describe('メンション剥がし（[To:aid]/[rp aid=... to=...]のみ・厳格文法）', () => {
    it('bot自身宛「[To:363]完了3」（表示名なし）は剥がして発火する', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botAccountId: '363' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = messageEvent({ body: '[To:363]完了3', account_id: 500 })
      await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '500')
    })

    it('他人宛「[To:99999]完了3」は剥がさず発火しない（厳格文法不一致・記録はされる）', async () => {
      const completeDigestTask = vi.fn()
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botAccountId: '363' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = messageEvent({ body: '[To:99999]完了3', account_id: 500 })
      await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
      expect(completeDigestTask).not.toHaveBeenCalled()
      expect(deps.insertMessage).toHaveBeenCalled()
    })

    it('自然文「完了しました！」は発火しない', async () => {
      const completeDigestTask = vi.fn()
      const deps = makeDeps({
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = messageEvent({ body: '完了しました！' })
      await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
      expect(completeDigestTask).not.toHaveBeenCalled()
      expect(deps.insertMessage).toHaveBeenCalled()
    })

    it('botAccountId未設定時は無加工。素の「完了3」のみ発火し、メンション付きは発火しない', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const withMention = messageEvent({ body: '[To:363]完了3', message_id: '2', account_id: 500 })
      await handleChatworkWebhook('acc-cw-1', withMention, sign(withMention), deps)
      expect(completeDigestTask).not.toHaveBeenCalled()

      const bare = messageEvent({ body: '完了3', message_id: '3', account_id: 500 })
      await handleChatworkWebhook('acc-cw-1', bare, sign(bare), deps)
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '500')
    })

    it('自分宛の返信マークアップ「[rp aid=363 to=108480917-1]完了4」は剥がして発火する', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botAccountId: '363' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = messageEvent({ body: '[rp aid=363 to=108480917-1]完了4', account_id: 500 })
      await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 4, '500')
    })

    it('他人宛の返信マークアップ「[rp aid=99999 to=108480917-1]完了4」は剥がさず発火しない', async () => {
      const completeDigestTask = vi.fn()
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botAccountId: '363' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = messageEvent({ body: '[rp aid=99999 to=108480917-1]完了4', account_id: 500 })
      await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
      expect(completeDigestTask).not.toHaveBeenCalled()
      expect(deps.insertMessage).toHaveBeenCalled()
    })
  })
})

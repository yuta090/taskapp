import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  handleSlackWebhook,
  buildAcceptedText,
  buildDigestDoneText,
  ALREADY_DONE_TEXT,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  type SlackWebhookDeps,
  type SlackAccount,
} from '@/lib/channels/slack/webhookHandler'

const SIGNING_SECRET = 'slack-signing-secret'
const NOW = 1_700_000_100
const TS = String(NOW) // request timestamp（署名対象）

const ACCOUNT: SlackAccount = {
  id: 'acc-sl-1',
  channel: 'slack',
  orgId: 'org-1',
  ownerType: 'org',
  status: 'active',
  credentials: { bot_token: 'xoxb-1', signing_secret: SIGNING_SECRET },
}

function sign(rawBody: string, timestamp = TS, secret = SIGNING_SECRET): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')
}

function eventBody(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    token: 'z',
    team_id: 'T123',
    api_app_id: 'A123',
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: NOW,
    event: {
      type: 'message',
      channel: 'C123',
      user: 'U999',
      text: '見積もりまだですか',
      ts: '1700000100.000200',
      channel_type: 'channel',
      ...over,
    },
  })
}

function makeDeps(over: Partial<SlackWebhookDeps> = {}): SlackWebhookDeps {
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
    reply: vi.fn().mockResolvedValue({ ts: '1700000200.000100' }),
    completeDigestTask: vi.fn().mockResolvedValue(null),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function auth(rawBody: string, over: Partial<{ signature: string; timestamp: string; nowSeconds: number }> = {}) {
  const timestamp = over.timestamp ?? TS
  return {
    signature: over.signature ?? sign(rawBody, timestamp),
    timestamp,
    nowSeconds: over.nowSeconds ?? NOW,
  }
}

// ---------------------------------------------------------------------------
// 凍結(characterization): 署名検証・リプレイ窓・url_verification・platform拒否・
// event形状フィルタは改修前後で不変。
// ---------------------------------------------------------------------------

describe('handleSlackWebhook — 認証（凍結）', () => {
  it('署名不一致は401で何も書かない', async () => {
    const deps = makeDeps()
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, { ...auth(body), signature: 'v0=bad' }, deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })

  it('署名/timestamp欠如は401', async () => {
    const deps = makeDeps()
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, { signature: null, timestamp: null, nowSeconds: NOW }, deps)
    expect(res.status).toBe(401)
  })

  it('リプレイ（5分超の古いtimestamp）は401', async () => {
    const deps = makeDeps()
    const oldTs = String(NOW - 400)
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, { signature: sign(body, oldTs), timestamp: oldTs, nowSeconds: NOW }, deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('未知アカウントは401（存在秘匿）', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const body = eventBody()
    const res = await handleSlackWebhook('nope', body, auth(body), deps)
    expect(res.status).toBe(401)
  })

  it('signing_secret 未設定は401', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, credentials: { bot_token: 'x' } }),
    })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(401)
  })

  it('platformアカウントは非対応(400)', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, ownerType: 'platform', orgId: null }),
    })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(400)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })
})

describe('handleSlackWebhook — url_verification（凍結）', () => {
  it('署名一致の url_verification は challenge を返し記録しない', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({ type: 'url_verification', challenge: 'CH4L' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(res.body.challenge).toBe('CH4L')
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('署名不一致の url_verification は401（未検証で challenge を返さない）', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({ type: 'url_verification', challenge: 'CH4L' })
    const res = await handleSlackWebhook('acc-sl-1', body, { ...auth(body), signature: 'v0=bad' }, deps)
    expect(res.status).toBe(401)
    expect(res.body.challenge).toBeUndefined()
  })
})

describe('handleSlackWebhook — event形状フィルタ（凍結）', () => {
  it('bot自身の発言(bot_id)はループ防止で無視', async () => {
    const deps = makeDeps()
    const body = eventBody({ bot_id: 'B123', user: undefined })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })

  it('subtype付き(message_changed/bot_message等)は無視', async () => {
    const deps = makeDeps()
    const body = eventBody({ subtype: 'message_changed' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('message以外のイベント(reaction_added等)は無視', async () => {
    const deps = makeDeps()
    const body = eventBody({ type: 'reaction_added' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('不正JSONは200（再送ループ回避）で記録しない', async () => {
    const deps = makeDeps()
    const res = await handleSlackWebhook('acc-sl-1', '{bad', auth('{bad'), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// claimed チャンネル
// ---------------------------------------------------------------------------

describe('handleSlackWebhook — claimed チャンネル', () => {
  it('active group があれば group_id 付きで記録し、通常発言は返信しない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      spaceId: 'space-1',
      groupId: 'grp-1',
      identityId: null,
      channel: 'slack',
      direction: 'inbound',
      actor: 'client',
      externalUserId: 'U999',
      body: '見積もりまだですか',
      accountId: 'acc-sl-1',
      contentType: 'text',
    })
    // dedupe キーは channel:ts（ch内でtsは一意・再送で不変）
    expect(arg.externalMessageId).toBe('C123:1700000100.000200')
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.hasExternalChatChannels).not.toHaveBeenCalled()
  })

  it('Slackリトライでもdedupで冪等に処理（duplicateでも200・完了処理は再実行しない）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      completeDigestTask,
    })
    const body = eventBody({ text: '完了2' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// limbo（未claim）: 沈黙不変条件・claim償還
// ---------------------------------------------------------------------------

describe('handleSlackWebhook — limbo（未claim）', () => {
  it('claimコード形状でない通常発言は完全沈黙（無保存・無返信）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null),
    })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
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
    const body = eventBody({ text: 'GC-CODE' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith('hash(CODE26)', 'acc-sl-1', 'C123', null, 50)
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', CODE_ONLY_LINKED_TEXT)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('既に別コードで登録済みのチャンネルは ALREADY 文言', async () => {
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
    const body = eventBody({ text: 'GC-CODE' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', CODE_ONLY_ALREADY_TEXT)
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
    const body = eventBody({ text: 'GC-CODE' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-sl-1',
        externalGroupId: 'C123',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', buildAcceptedText('AB12'))
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('無効コードはINVALID文言（レート未超過）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    const body = eventBody({ text: 'GC-XXXX' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', INVALID_TEXT)
  })

  it('無効コードでもレート超過後は無返信', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    const body = eventBody({ text: 'GC-XXXX' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
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
    const body = eventBody({ text: 'GC-CODE' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', INVALID_TEXT)
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
    const body = eventBody({ text: 'GC-CODE' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', INVALID_TEXT)
  })

  it('未claimグループで「完了2」を送っても完了処理も返信も一切起きない（沈黙不変条件）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null), // コード形状でもない通常発言扱い
      completeDigestTask,
    })
    const body = eventBody({ text: '完了2' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 完了コマンド（claimedのみ）
// ---------------------------------------------------------------------------

describe('handleSlackWebhook — 完了コマンド（claimed経路限定）', () => {
  const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

  it('claimedグループの「完了2」でタスクを完了し、成功文言でreply・outbound記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: '見積書の送付' })
    const insertOutbound = vi.fn().mockResolvedValue(undefined)
    const reply = vi.fn().mockResolvedValue({ ts: '1700000300.000100' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
      insertOutbound,
      reply,
    })
    const body = eventBody({ text: '完了2' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)

    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 2, 'U999')
    expect(reply).toHaveBeenCalledWith('xoxb-1', 'C123', buildDigestDoneText('見積書の送付'))
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        groupId: 'grp-1',
        channel: 'slack',
        direction: 'outbound',
        actor: 'secretary',
        body: buildDigestDoneText('見積書の送付'),
        status: 'sent',
        payload: expect.objectContaining({ provider_message_id: '1700000300.000100' }),
      }),
    )
  })

  it('該当タスクが無い（既に完了済み等）場合はALREADY_DONE_TEXTでreplyする', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask: vi.fn().mockResolvedValue(null),
    })
    const body = eventBody({ text: '完了2' })
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', ALREADY_DONE_TEXT)
  })

  describe('メンション剥がし（<@U…>/<@W…>のみ・厳格文法）', () => {
    it('bot自身宛「<@UBOT0001> 完了3」（botUserId一致）は剥がして発火する', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botUserId: 'UBOT0001' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = eventBody({ text: '<@UBOT0001> 完了3' })
      await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, 'U999')
    })

    it('他人宛「<@UOTHER99> 完了3」は剥がさず発火しない（厳格文法不一致）', async () => {
      const completeDigestTask = vi.fn()
      const deps = makeDeps({
        loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botUserId: 'UBOT0001' }),
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const body = eventBody({ text: '<@UOTHER99> 完了3' })
      await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
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
      const body = eventBody({ text: '完了しました！' })
      await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
      expect(completeDigestTask).not.toHaveBeenCalled()
      expect(deps.insertMessage).toHaveBeenCalled()
    })

    it('botUserId未設定時は無加工。素の「完了3」のみ発火し、メンション付きは発火しない', async () => {
      const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
      const deps = makeDeps({
        findActiveGroup: vi.fn().mockResolvedValue(GROUP),
        completeDigestTask,
      })
      const withMention = eventBody({ text: '<@UBOT0001> 完了3', ts: '1700000100.000201' })
      await handleSlackWebhook('acc-sl-1', withMention, auth(withMention), deps)
      expect(completeDigestTask).not.toHaveBeenCalled()

      const bare = eventBody({ text: '完了3', ts: '1700000100.000202' })
      await handleSlackWebhook('acc-sl-1', bare, auth(bare), deps)
      expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, 'U999')
    })
  })
})

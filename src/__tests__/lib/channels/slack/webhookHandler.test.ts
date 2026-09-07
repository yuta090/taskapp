import { describe, it, expect, vi } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
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
    // ボタン押下への返事は response_url（押した本人にだけ見える・場所を選ばない）
    respondToInteraction: vi.fn().mockResolvedValue(undefined),
    completeDigestTask: vi.fn().mockResolvedValue(null),
    createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-new', pending: false, duplicate: false }),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    // 「一覧」の土台（番号がまだ無いタスクにだけ続きの番号を与える）。配線必須
    assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]),
    // 期限リマインドの確認ボタン（LINE の postback と同じ RPC に配線する）
    confirmTaskDone: vi.fn().mockResolvedValue({ status: 'done' }),
    snoozeDueReminder: vi.fn().mockResolvedValue({ status: 'snoozed' }),
    findTaskTitle: vi.fn().mockResolvedValue('見積書の送付'),
    // 本人紐づけコード（DM で受ける）と、チャンネルに貼られたコードの失効
    consumeUserLinkCode: vi.fn().mockResolvedValue({ status: 'ok', linkId: 'link-1' }),
    expireUserLinkCode: vi.fn().mockResolvedValue(true),
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
    expect(res.body?.challenge).toBe('CH4L')
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('署名不一致の url_verification は401（未検証で challenge を返さない）', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({ type: 'url_verification', challenge: 'CH4L' })
    const res = await handleSlackWebhook('acc-sl-1', body, { ...auth(body), signature: 'v0=bad' }, deps)
    expect(res.status).toBe(401)
    expect(res.body?.challenge).toBeUndefined()
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


// ---------------------------------------------------------------------------
// 期限リマインドの確認ボタン（Slack Interactivity / block_actions）。
// Slack は application/x-www-form-urlencoded の payload=<JSON> で届ける。署名は生ボディに対して
// 検証する（イベント購読と同じ受信URL・同じ signing_secret）。
// ---------------------------------------------------------------------------

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const OCC_ID = '22222222-2222-4222-8222-222222222222'

function actionBody(over: Partial<{ actionId: string; value: string; user: string; channel: string; actionTs: string; type: string }> = {}) {
  const payload = {
    type: over.type ?? 'block_actions',
    user: { id: over.user ?? 'U999' },
    channel: { id: over.channel ?? 'D123' },
    message: { ts: '1700000100.000200' },
    trigger_id: '13345224609.738474920.8088930838d88f008e0',
    response_url: 'https://hooks.slack.com/actions/T123/xxx',
    actions: [
      {
        type: 'button',
        block_id: `due_reminder:${OCC_ID}`,
        action_id: over.actionId ?? 'due_reminder_done',
        value: over.value ?? `action=due_reminder_done&task=${TASK_ID}`,
        action_ts: over.actionTs ?? '1700000150.123456',
      },
    ],
  }
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`
}

describe('handleSlackWebhook — 期限リマインドの確認ボタン（block_actions）', () => {
  it('署名が合わなければ 401（フォーム形式のボディでも同じ）', async () => {
    const body = actionBody()
    const deps = makeDeps()
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body, { signature: 'v0=bad' }), deps)
    expect(r.status).toBe(401)
    expect(deps.confirmTaskDone).not.toHaveBeenCalled()
  })

  it('[完了した]: 検証済みの (account.id, 押した人の Slack user id) と task で RPC を呼び、完了の返事を同じ場所に出す', async () => {
    const body = actionBody()
    const deps = makeDeps()
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(r.status).toBe(200)
    // Slack の Interactivity は「200・空ボディ」が作法（JSON を返すと元メッセージの置換と解釈されうる）
    expect(r.body).toBeNull()
    expect(deps.confirmTaskDone).toHaveBeenCalledWith(ACCOUNT.id, 'U999', TASK_ID)
    // 返事はチャンネルへの投稿ではなく response_url（押した本人にだけ見える）。bot token は使わない
    expect(deps.respondToInteraction).toHaveBeenCalledWith('https://hooks.slack.com/actions/T123/xxx', '『見積書の送付』を完了にしました。')
    expect(deps.reply).not.toHaveBeenCalled()
    // 秘書の返事も outbound として残す（2AM の切り分け用・LINE の sendSecretaryText と同じ）
    expect(deps.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', actor: 'secretary', direction: 'outbound', body: '『見積書の送付』を完了にしました。' }),
    )
    // 監査行（system/inbound）を残す。dedupe は action_ts
    expect(deps.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        accountId: ACCOUNT.id,
        actor: 'system',
        direction: 'inbound',
        externalUserId: 'U999',
        externalMessageId: 'D123:action:1700000150.123456',
        payload: expect.objectContaining({ event: 'block_actions', action: 'due_reminder_done', taskId: TASK_ID, result: 'done' }),
      }),
    )
  })

  it('[完了した] が already_done なら「すでに完了済みです。」、blocked なら「アプリで内容を確認してください。」', async () => {
    const body = actionBody()
    const d1 = makeDeps({ confirmTaskDone: vi.fn().mockResolvedValue({ status: 'already_done' }) })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), d1)
    expect(d1.respondToInteraction).toHaveBeenCalledWith('https://hooks.slack.com/actions/T123/xxx', 'すでに完了済みです。')

    const d2 = makeDeps({ confirmTaskDone: vi.fn().mockResolvedValue({ status: 'blocked' }) })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), d2)
    expect(d2.respondToInteraction).toHaveBeenCalledWith('https://hooks.slack.com/actions/T123/xxx', 'アプリで内容を確認してください。')
  })

  it('forbidden（紐づいていない人が押した）は完全沈黙（返事も監査行も残さない）', async () => {
    const body = actionBody()
    const deps = makeDeps({ confirmTaskDone: vi.fn().mockResolvedValue({ status: 'forbidden' }) })
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(r.status).toBe(200)
    expect(deps.respondToInteraction).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.insertOutbound).not.toHaveBeenCalled()
  })

  it('[対応中]/[明日また確認]: value の世代(gen)ごと snooze RPC に渡し、「1日後に再通知します。」と返す', async () => {
    const body = actionBody({
      actionId: 'due_reminder_snooze_tomorrow',
      value: `action=due_reminder_snooze&occurrence=${OCC_ID}&days=1&gen=2`,
    })
    const deps = makeDeps()
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(deps.snoozeDueReminder).toHaveBeenCalledWith(ACCOUNT.id, 'U999', OCC_ID, 1, 2)
    expect(deps.confirmTaskDone).not.toHaveBeenCalled()
    expect(deps.respondToInteraction).toHaveBeenCalledWith('https://hooks.slack.com/actions/T123/xxx', '1日後に再通知します。')
  })

  it('snooze が capped なら上限の文言、already_snoozed/not_found（古いボタン）は沈黙', async () => {
    const body = actionBody({
      actionId: 'due_reminder_snooze_working',
      value: `action=due_reminder_snooze&occurrence=${OCC_ID}&days=1&gen=0`,
    })
    const d1 = makeDeps({ snoozeDueReminder: vi.fn().mockResolvedValue({ status: 'capped' }) })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), d1)
    expect(d1.respondToInteraction).toHaveBeenCalledWith('https://hooks.slack.com/actions/T123/xxx', '再通知の上限に達しました。')

    const d2 = makeDeps({ snoozeDueReminder: vi.fn().mockResolvedValue({ status: 'already_snoozed' }) })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), d2)
    expect(d2.respondToInteraction).not.toHaveBeenCalled()
    expect(d2.insertMessage).not.toHaveBeenCalled()
  })

  it('同じ押下の再送（監査行が duplicate）には返事を繰り返さない', async () => {
    const body = actionBody()
    const deps = makeDeps({ insertMessage: vi.fn().mockResolvedValue('duplicate') })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(deps.respondToInteraction).not.toHaveBeenCalled()
    expect(deps.insertOutbound).not.toHaveBeenCalled()
  })

  it('response_url が無いペイロードには返事を出さない（チャンネルへ投稿して社内タスク名を漏らさない）', async () => {
    const payload = JSON.parse(decodeURIComponent(actionBody().slice('payload='.length))) as Record<string, unknown>
    delete payload.response_url
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`
    const deps = makeDeps()
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(deps.confirmTaskDone).toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.respondToInteraction).not.toHaveBeenCalled()
  })

  it('value が壊れている／期限リマインド以外の action_id は無視して 200', async () => {
    const b1 = actionBody({ value: 'action=due_reminder_done&task=not-a-uuid' })
    const d1 = makeDeps()
    expect((await handleSlackWebhook(ACCOUNT.id, b1, auth(b1), d1)).status).toBe(200)
    expect(d1.confirmTaskDone).not.toHaveBeenCalled()

    const b2 = actionBody({ actionId: 'something_else' })
    const d2 = makeDeps()
    expect((await handleSlackWebhook(ACCOUNT.id, b2, auth(b2), d2)).status).toBe(200)
    expect(d2.confirmTaskDone).not.toHaveBeenCalled()
    expect(d2.respondToInteraction).not.toHaveBeenCalled()
  })

  it('RPC が例外を投げたら何も残さず 200（押し直しで回復する）', async () => {
    const body = actionBody()
    const deps = makeDeps({ confirmTaskDone: vi.fn().mockRejectedValue(new Error('db down')) })
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(r.status).toBe(200)
    expect(deps.respondToInteraction).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('block_actions 以外の対話（view_submission 等）は無視して 200', async () => {
    const body = actionBody({ type: 'view_submission' })
    const deps = makeDeps()
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(r.status).toBe(200)
    expect(deps.confirmTaskDone).not.toHaveBeenCalled()
  })
})


// ---------------------------------------------------------------------------
// 本人紐づけ（Slack ユーザー → AgentPM ユーザー）。AgentPM で発行した TA- コードを、秘書への
// DM（channel_type='im'）に送ると成立する。LINE の 1:1 トークと同じ手順・同じ RPC。
// ---------------------------------------------------------------------------

const USER_LINK_CODE = 'TA-0123456789ABCDEFGHJKMNPQRS'
const USER_LINK_CODE_HASH = createHash('sha256').update(USER_LINK_CODE).digest('hex')

describe('handleSlackWebhook — 本人紐づけコード（DM）', () => {
  it('DM に TA- コードが届いたら、(hash, account.id, 送った人の Slack user id) で consume し、成立の返事を DM に返す', async () => {
    const body = eventBody({ channel: 'D777', channel_type: 'im', text: `よろしく ${USER_LINK_CODE}` })
    const deps = makeDeps()
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(r.status).toBe(200)
    expect(deps.consumeUserLinkCode).toHaveBeenCalledWith(USER_LINK_CODE_HASH, ACCOUNT.id, 'U999')
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'D777', expect.stringContaining('連携しました'))
    // 秘書の返事も outbound として残す（LINE の sendSecretaryText と同じ・2AM の切り分け用）
    expect(deps.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', groupId: null, actor: 'secretary', direction: 'outbound', body: expect.stringContaining('連携しました'), status: 'sent' }),
    )
    // チャンネルの合言葉・承認の流れには入らない
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
    expect(deps.createPendingClaim).not.toHaveBeenCalled()
  })

  it('会話ログには平文コードを残さない（本文はマスク・payload に生イベントを入れない）・groupId なし', async () => {
    const body = eventBody({ channel: 'D777', channel_type: 'im', text: USER_LINK_CODE })
    const deps = makeDeps()
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const input = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(input).toMatchObject({ orgId: 'org-1', groupId: null, actor: 'client', externalUserId: 'U999', externalMessageId: 'D777:1700000100.000200' })
    expect(JSON.stringify(input)).not.toContain(USER_LINK_CODE)
  })

  it('状態ごとの返事: invalid / expired / locked / conflict は本人が自力で直せる案内、再送(duplicate)には返事しない', async () => {
    const body = eventBody({ channel: 'D777', channel_type: 'im', text: USER_LINK_CODE })
    for (const [status, fragment] of [
      ['invalid', '無効'],
      ['expired', '有効期限'],
      ['locked', '試行回数'],
      ['conflict', '別のユーザー'],
    ] as const) {
      const deps = makeDeps({ consumeUserLinkCode: vi.fn().mockResolvedValue({ status, linkId: null }) })
      await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
      expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'D777', expect.stringContaining(fragment))
    }
    const dup = makeDeps({ insertMessage: vi.fn().mockResolvedValue('duplicate') })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), dup)
    expect(dup.reply).not.toHaveBeenCalled()
  })

  it('DM にコード以外の文章が届いても何もしない（consume も返事も記録もしない）', async () => {
    const body = eventBody({ channel: 'D777', channel_type: 'im', text: 'こんにちは' })
    const deps = makeDeps({ normalizeClaimCode: vi.fn().mockReturnValue('ABCD-1234') })
    const r = await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(r.status).toBe(200)
    expect(deps.consumeUserLinkCode).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
  })

  it('紐づけ済みチャンネルに TA- コードが貼られたら即失効し、マスクして記録し、「DM に送って」と返す（合図としては扱わない）', async () => {
    const body = eventBody({ text: `これです ${USER_LINK_CODE}` })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'sp-1' }),
    })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(deps.expireUserLinkCode).toHaveBeenCalledWith(USER_LINK_CODE_HASH)
    expect(deps.consumeUserLinkCode).not.toHaveBeenCalled()
    const input = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(input).toMatchObject({ groupId: 'grp-1', actor: 'client' })
    expect(JSON.stringify(input)).not.toContain(USER_LINK_CODE)
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', expect.stringContaining('無効化しました'))
    expect(deps.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', groupId: 'grp-1', actor: 'secretary', body: expect.stringContaining('無効化しました') }),
    )
    expect(deps.createInstantDigestTask).not.toHaveBeenCalled()
    expect(deps.completeDigestTask).not.toHaveBeenCalled()
  })

  it('失効できなかった（使用済み等）なら「無効化しました」とは言わず、DM に送る案内だけ返す', async () => {
    const body = eventBody({ text: USER_LINK_CODE })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'sp-1' }),
      expireUserLinkCode: vi.fn().mockResolvedValue(false),
    })
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    const text = (deps.reply as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
    expect(text).not.toContain('無効化しました')
    expect(text).toContain('DM')
  })

  it('未紐づけ（limbo）チャンネルに貼られた場合も失効＋案内（記録は0行・合言葉の判定に入らない）', async () => {
    const body = eventBody({ text: USER_LINK_CODE })
    const deps = makeDeps()
    await handleSlackWebhook(ACCOUNT.id, body, auth(body), deps)
    expect(deps.expireUserLinkCode).toHaveBeenCalledWith(USER_LINK_CODE_HASH)
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('xoxb-1', 'C123', expect.stringContaining('DM'))
  })
})

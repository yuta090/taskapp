import { describe, it, expect, vi } from 'vitest'
import { renderHelpReplyText } from '@/lib/channels/commandGuides'
import {
  ADD_TASK_EMPTY_TEXT,
  COMPLETE_WITHOUT_NUMBER_TEXT,
  LIST_EMPTY_TEXT,
  buildAddTaskDoneText,
  buildAddTaskDoneNoDigestText,
} from '@/lib/channels/groupCommands'
import {
  handleDiscordIngest,
  buildAcceptedText,
  buildDigestDoneText,
  ALREADY_DONE_TEXT,
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
    completeDigestTask: vi.fn().mockResolvedValue(null),
    createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-new', pending: false, duplicate: false }),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    // 「一覧」の土台（番号がまだ無いタスクにだけ続きの番号を与える）。配線必須
    assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]),
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
    // 上限(cap.max=50・makeDeps既定)を5番目に渡す＝RPCのアトミック強制用
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith('hash(CODE26)', 'acc-discord-plat', 'C1', null, 50)
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

describe('handleDiscordIngest — 完了コマンド（claimed経路限定）', () => {
  const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

  it('claimedグループの「完了1」でタスクを完了し、成功文言で返信・記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: '見積書の送付' })
    const insertOutbound = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
      insertOutbound,
    })
    await handleDiscordIngest([event({ content: '完了1' })], deps)

    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 1, 'U1')
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', buildDigestDoneText('見積書の送付'))
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        groupId: 'grp-1',
        channel: 'discord',
        direction: 'outbound',
        actor: 'secretary',
        body: buildDigestDoneText('見積書の送付'),
        status: 'sent',
      }),
    )
  })

  it('duplicate（再送）は完了処理を呼ばない', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: 'x' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      completeDigestTask,
    })
    await handleDiscordIngest([event({ content: '完了1' })], deps)

    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('該当タスクが無い（既に完了済み等）場合はALREADY_DONE_TEXTで返信する', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask: vi.fn().mockResolvedValue(null),
    })
    await handleDiscordIngest([event({ content: '完了1' })], deps)

    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', ALREADY_DONE_TEXT)
  })

  it('未claim(limbo)グループでは「完了1」を送っても完了処理も返信も一切起きない（沈黙不変条件）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(null),
      normalizeClaimCode: vi.fn().mockReturnValue(null), // コード形状でもない通常発言扱い
      completeDigestTask,
    })
    const res = await handleDiscordIngest([event({ content: '完了1' })], deps)

    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(res.inserted).toBe(0)
  })

  it('bot_external_id設定時: 自分宛メンション「<@BOT> 完了1」は発火する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
    const deps = makeDeps({
      loadPlatformAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botExternalId: '111222333' }),
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
    })
    await handleDiscordIngest([event({ content: '<@111222333> 完了1' })], deps)
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 1, 'U1')
  })

  it('他人宛メンション「<@OTHER> 完了1」は剥がさず発火しない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      loadPlatformAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botExternalId: '111222333' }),
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
    })
    await handleDiscordIngest([event({ content: '<@999888777> 完了1' })], deps)
    expect(completeDigestTask).not.toHaveBeenCalled()
  })

  it('bot_external_id未設定時は素の「完了1」のみ発火し、メンション付きは剥がされず発火しない', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 't', title: 'x' })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
    })
    await handleDiscordIngest([event({ content: '<@111222333> 完了1', messageId: 'M1' })], deps)
    expect(completeDigestTask).not.toHaveBeenCalled()

    await handleDiscordIngest([event({ content: '完了1', messageId: 'M2' })], deps)
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 1, 'U1')
  })

  it('誤爆防止: メンション付き自然文「<@BOT> あの件は完了しました」では発火しない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      loadPlatformAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botExternalId: '111222333' }),
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
    })
    await handleDiscordIngest([event({ content: '<@111222333> あの件は完了しました' })], deps)
    expect(completeDigestTask).not.toHaveBeenCalled()
    // 通常発言としては記録される（沈黙にはならない・監査ログは保つ）
    expect(deps.insertMessage).toHaveBeenCalled()
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

/**
 * 使い方案内（ヘルプ）と、その場の登録（タスク追加）の配線。
 * 「Discordでタスクをどう消すのか分からない」という困りごとに直接効く2つ。
 */
describe('handleDiscordIngest — ヘルプ / タスク追加（claimed経路限定）', () => {
  const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

  it('「ヘルプ」で使い方を返信し、秘書の発言として記録する', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleDiscordIngest([event({ content: 'ヘルプ' })], deps)

    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', renderHelpReplyText('discord'))
    expect(deps.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'grp-1', channel: 'discord', actor: 'secretary' }),
    )
  })

  it('未登録（limbo）チャンネルの「ヘルプ」には答えない（沈黙の原則を緩めない）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(null) })
    await handleDiscordIngest([event({ content: 'ヘルプ' })], deps)

    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.insertOutbound).not.toHaveBeenCalled()
  })

  it('「タスク追加 見積書を送る」でタスクを1件作り、記録した発言を出どころにする', async () => {
    const createInstantDigestTask = vi
      .fn()
      .mockResolvedValue({ id: 'task-new', pending: false, duplicate: false })
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage: vi.fn().mockResolvedValue({ id: 'row-77' }),
      createInstantDigestTask,
    })
    await handleDiscordIngest([event({ content: 'タスク追加 見積書を送る' })], deps)

    expect(createInstantDigestTask).toHaveBeenCalledWith({
      groupId: 'grp-1',
      sourceMessageId: 'row-77',
      title: '見積書を送る',
      assigneeExternalUserId: 'U1',
    })
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', buildAddTaskDoneText('見積書を送る'))
  })

  it('「タスク追加」だけなら内容が読めない旨を返し、タスクは作らない', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleDiscordIngest([event({ content: 'タスク追加' })], deps)

    expect(deps.createInstantDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', ADD_TASK_EMPTY_TEXT)
  })

  it('自分宛メンション付き「<@BOT> ヘルプ」も読み取る', async () => {
    const deps = makeDeps({
      loadPlatformAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, botExternalId: '111222333' }),
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
    })
    await handleDiscordIngest([event({ content: '<@111222333> ヘルプ' })], deps)
    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', renderHelpReplyText('discord'))
  })

  it('ふつうの会話（「ヘルプが欲しい」）では返信しない（会話に割り込まない）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleDiscordIngest([event({ content: 'ヘルプが欲しいです' })], deps)

    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertOutbound).not.toHaveBeenCalled()
    // 通常発言としては記録される（監査ログは保つ）
    expect(deps.insertMessage).toHaveBeenCalled()
  })
})

/**
 * 「一覧」と番号なしの「完了」の配線（共通層の実装は groupCommands.test.ts が担保）。
 * ここで見るのは「チャネルの配線が通っているか」— 1チャネルでも配線を落とすと、
 * そのチャネルだけ打っても無反応になる。
 */
describe('handleDiscordIngest — 一覧 / 番号なしの完了（claimed経路限定）', () => {
  const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

  it('「一覧」でいまのタスクを番号付きで返す（番号は振り直さない）', async () => {
    const assignDigestNumbersToNewTasks = vi.fn().mockResolvedValue([
      { id: 't-1', digestNumber: 1, title: '見積書を送る' },
      { id: 't-4', digestNumber: 4, title: '請求書を出す' },
    ])
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      assignDigestNumbersToNewTasks,
    })
    await handleDiscordIngest([event({ content: '一覧' })], deps)

    expect(assignDigestNumbersToNewTasks).toHaveBeenCalledWith('grp-1')
    const replied = (deps.reply as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
    expect(replied).toContain('1. 見積書を送る')
    expect(replied).toContain('4. 請求書を出す')
  })

  it('0件でも「ありません」と返す（沈黙しない）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]),
    })
    await handleDiscordIngest([event({ content: '一覧' })], deps)

    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', LIST_EMPTY_TEXT)
  })

  it('未登録（limbo）チャンネルの「一覧」には答えない（沈黙の原則を緩めない）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(null) })
    await handleDiscordIngest([event({ content: '一覧' })], deps)

    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.assignDigestNumbersToNewTasks).not.toHaveBeenCalled()
  })

  it('番号なしの「完了」には番号の付け方と「一覧」を案内する（沈黙しない）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleDiscordIngest([event({ content: '完了' })], deps)

    expect(deps.reply).toHaveBeenCalledWith('bot-token', 'C1', COMPLETE_WITHOUT_NUMBER_TEXT)
    expect(deps.completeDigestTask).not.toHaveBeenCalled()
  })
})

/**
 * 拾い方が「取り込まない(off)」のグループに、届かないまとめを約束しない（配線の確認）。
 * 判定そのものは groupCommands 側のテストで担保しているので、ここは「値が渡っているか」だけ見る。
 */
describe('handleDiscordIngest — 拾い方が「取り込まない(off)」のとき', () => {
  const GROUP_OFF = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1', pickupMode: 'off' }

  it('off のグループでは「次にお届けする一覧に載ります」と返さない', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP_OFF) })
    await handleDiscordIngest([event({ content: 'タスク追加 見積書を送る' })], deps)

    expect(deps.reply).toHaveBeenCalledWith(
      'bot-token',
      'C1',
      buildAddTaskDoneNoDigestText('見積書を送る'),
    )
  })
})

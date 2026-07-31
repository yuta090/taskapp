import { describe, it, expect, vi } from 'vitest'
import {
  handleClaimedGroupMessage,
  handleLimboGroupMessage,
  buildAddTaskDoneText,
  APPROVAL_REQUESTED_TEXT,
  type GroupCommandDeps,
  type GroupCommandParams,
  type LimboGroupDeps,
  type LimboGroupParams,
} from '@/lib/channels/groupCommands'
import { CODE_ONLY_LINKED_TEXT, INVALID_TEXT, buildDigestDoneText } from '@/lib/channels/claimLimboCore'
import {
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_COMPLETED_TEXT,
  TUTORIAL_SKIPPED_TEXT,
  buildTutorialAddedText,
} from '@/lib/channels/tutorial/messages'
import type { ChannelTutorialState } from '@/lib/channels/tutorial/state'

/**
 * 登録直後の練習（対話型チュートリアル）が、各チャットの合図の振り分けに正しく噛んでいるか。
 *
 * 特に守るべき2つ:
 *   - 未登録（limbo）グループの応答は1文字も変えない。無効コードの文言は同一のまま。
 *   - コンソール承認待ち（web_approval の pending）を「成立」と誤認して練習を始めない。
 */

const NOW = new Date('2026-07-30T09:00:00.000Z')

function makeParams(over: Partial<GroupCommandParams<'discord'>> = {}): GroupCommandParams<'discord'> {
  return {
    orgId: 'org-1',
    spaceId: 'space-1',
    accountId: 'acc-1',
    groupId: 'grp-1',
    channel: 'discord',
    externalUserId: 'u-1',
    autoReplyTo: 'msg-1',
    sourceMessageId: 'row-1',
    text: 'こんにちは',
    groupCreatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    groupMetadata: null,
    ...over,
  }
}

function withTutorial(state: ChannelTutorialState, over: Partial<GroupCommandParams<'discord'>> = {}) {
  return makeParams({ groupMetadata: { tutorial: state }, ...over })
}

function makeDeps(over: Partial<GroupCommandDeps<'discord'>> = {}): GroupCommandDeps<'discord'> {
  return {
    completeDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', title: '秘書の使い方をおぼえる' }),
    createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', pending: false, duplicate: false }),
    reply: vi.fn().mockResolvedValue({ providerMessageId: null }),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    assignDigestNumbersToNewTasks: vi
      .fn()
      .mockResolvedValue([{ id: 'task-9', digestNumber: 1, title: '秘書の使い方をおぼえる' }]),
    updateGroupMetadata: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  }
}

function replies(deps: { reply: unknown }): string[] {
  return (deps.reply as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string)
}

function savedTutorial(deps: GroupCommandDeps<'discord'>): ChannelTutorialState {
  const calls = (deps.updateGroupMetadata as ReturnType<typeof vi.fn>).mock.calls
  return (calls[calls.length - 1][1] as { tutorial: ChannelTutorialState }).tutorial
}

describe('handleClaimedGroupMessage × 練習', () => {
  const awaitingAdd: ChannelTutorialState = { step: 'awaiting_add', startedAt: NOW.toISOString() }

  it('練習中の「タスク追加 ○○」は、いつもの返事のあとに「完了N」の練習を案内する', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(
      withTutorial(awaitingAdd, { text: 'タスク追加 秘書の使い方をおぼえる' }),
      deps,
    )

    expect(replies(deps)).toEqual([
      buildAddTaskDoneText('秘書の使い方をおぼえる'),
      buildTutorialAddedText(1, '秘書の使い方をおぼえる'),
    ])
    expect(savedTutorial(deps)).toMatchObject({ step: 'awaiting_done', taskId: 'task-9', digestNumber: 1 })
    // 練習の発話も秘書の発言として記録する（監査ログ）
    expect(deps.insertOutbound).toHaveBeenCalledTimes(2)
  })

  it('練習中の「完了N」は、いつもの完了の返事のあとに締めの文を返す', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(
      withTutorial(
        { step: 'awaiting_done', taskId: 'task-9', digestNumber: 1, startedAt: NOW.toISOString() },
        { text: '完了1' },
      ),
      deps,
    )

    expect(replies(deps)).toEqual([buildDigestDoneText('秘書の使い方をおぼえる'), TUTORIAL_COMPLETED_TEXT])
    expect(savedTutorial(deps)).toMatchObject({ step: 'finished' })
  })

  it('「あとで」で練習から抜けられる（ふつうの発言としては沈黙のまま）', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(withTutorial(awaitingAdd, { text: 'あとで' }), deps)

    expect(replies(deps)).toEqual([TUTORIAL_SKIPPED_TEXT])
    expect(savedTutorial(deps)).toMatchObject({ step: 'finished' })
  })

  it('練習をしていないグループの「あとで」は沈黙（勝手に反応しない）', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(
      makeParams({
        text: 'あとで',
        // 前からある接続（48時間より前に作られた）
        groupCreatedAt: '2026-07-01T00:00:00.000Z',
      }),
      deps,
    )

    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('コンソール承認で成立した新しいグループでは、最初のふつうの発言から練習を始める', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(makeParams({ text: 'おはようございます' }), deps)

    expect(replies(deps)).toEqual([TUTORIAL_INTRO_TEXT])
    expect(savedTutorial(deps)).toMatchObject({ step: 'awaiting_add' })
  })

  // 練習の状態を保存する配線（updateGroupMetadata）が無ければ練習は動かない。
  // 採番（assignDigestNumbersToNewTasks）は「一覧」でも使うため配線必須になった＝ここでは外せない。
  it('練習の配線が無いときは、これまでどおり沈黙する（挙動を変えない）', async () => {
    const deps = makeDeps({ updateGroupMetadata: undefined })
    const res = await handleClaimedGroupMessage(makeParams({ text: 'おはようございます' }), deps)

    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('練習の保存に失敗しても、いつもの返事は壊れない', async () => {
    const deps = makeDeps({ updateGroupMetadata: vi.fn().mockRejectedValue(new Error('db down')) })
    const res = await handleClaimedGroupMessage(
      withTutorial(awaitingAdd, { text: 'タスク追加 秘書の使い方をおぼえる' }),
      deps,
    )

    expect(res).toEqual({ matched: 'add_task' })
    expect(replies(deps)[0]).toBe(buildAddTaskDoneText('秘書の使い方をおぼえる'))
  })

  it('責任者の承認が要るタスクになったら、練習は静かに終える', async () => {
    const deps = makeDeps({
      createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', pending: true, duplicate: false }),
    })
    await handleClaimedGroupMessage(
      withTutorial(awaitingAdd, { text: 'タスク追加 秘書の使い方をおぼえる' }),
      deps,
    )

    // 承認待ちなので「一覧に載ります」とは言わない（LINE と同じ文言に寄せる）
    expect(replies(deps)).toEqual([APPROVAL_REQUESTED_TEXT])
    expect(savedTutorial(deps)).toMatchObject({ step: 'finished' })
  })
})

describe('タスク追加の返事', () => {
  it('承認が要らないときは「次にお届けする一覧」と伝える（当日中に配信されることもある）', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(makeParams({ text: 'タスク追加 見積もりを送る' }), deps)

    expect(replies(deps)[0]).toBe(buildAddTaskDoneText('見積もりを送る'))
    expect(buildAddTaskDoneText('見積もりを送る')).toBe(
      '「見積もりを送る」をお預かりしました。次にお届けするお知らせに載ります。',
    )
    expect(buildAddTaskDoneText('見積もりを送る')).not.toContain('明日の朝')
  })

  it('責任者の承認待ちになったら「一覧に載ります」とは言わない（練習をしていないグループでも同じ）', async () => {
    const deps = makeDeps({
      createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', pending: true, duplicate: false }),
    })
    const res = await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る', groupCreatedAt: '2026-07-01T00:00:00.000Z' }),
      deps,
    )

    expect(res).toEqual({ matched: 'add_task' })
    expect(replies(deps)).toEqual([APPROVAL_REQUESTED_TEXT])
  })

  it('承認待ちの文言は LINE と同じ正本を使う（コピーしない）', () => {
    expect(APPROVAL_REQUESTED_TEXT).toBe(
      '責任者に確認をお願いしました。承認されると本体タスクになります。',
    )
  })
})

// ---- 未登録（limbo）グループ ----

function makeLimboParams(over: Partial<LimboGroupParams> = {}): LimboGroupParams {
  return {
    accountId: 'acc-1',
    externalGroupId: 'ext-1',
    channel: 'discord',
    text: 'CODE',
    ...over,
  }
}

function makeLimboDeps(over: Partial<LimboGroupDeps> = {}): LimboGroupDeps {
  return {
    normalizeClaimCode: vi.fn((content: string) => (content === 'CODE' ? 'canonical' : null)),
    hashClaimCode: vi.fn(() => 'hash'),
    findValidClaimCode: vi
      .fn()
      .mockResolvedValue({ id: 'lc-1', orgId: 'org-1', spaceId: 'space-1', bindingMode: 'code_only' }),
    hasExternalChatChannels: vi.fn().mockResolvedValue(true),
    externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 0, max: null }),
    createPendingClaim: vi.fn().mockResolvedValue({ challengeLabel: '1234' }),
    redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    generateChallengeLabel: vi.fn(() => '1234'),
    registerInvalidAttempt: vi.fn(() => false),
    reply: vi.fn().mockResolvedValue(undefined),
    findActiveGroup: vi.fn().mockResolvedValue({
      id: 'grp-1',
      createdAt: new Date(NOW.getTime() - 1000).toISOString(),
      metadata: null,
    }),
    assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]),
    updateGroupMetadata: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  }
}

describe('handleLimboGroupMessage', () => {
  it('登録が成立したら、成立の文言はそのままで、そのあとに練習の入り口を送る', async () => {
    const deps = makeLimboDeps()
    const res = await handleLimboGroupMessage(makeLimboParams(), deps)

    expect(res).toEqual({ claimCreated: true })
    // 1通目は既存の成立文言のまま（1文字も変えない）
    expect(replies(deps)).toEqual([CODE_ONLY_LINKED_TEXT, TUTORIAL_INTRO_TEXT])
    expect((deps.updateGroupMetadata as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('grp-1')
  })

  it('コンソール承認待ち（まだ登録されていない）では練習を始めない', async () => {
    const deps = makeLimboDeps({
      findValidClaimCode: vi
        .fn()
        .mockResolvedValue({ id: 'lc-1', orgId: 'org-1', spaceId: 'space-1', bindingMode: 'web_approval' }),
      // 承認前なのでグループはまだ無い
      findActiveGroup: vi.fn().mockResolvedValue(null),
    })
    await handleLimboGroupMessage(makeLimboParams(), deps)

    expect(replies(deps)).toHaveLength(1)
    expect(replies(deps)[0]).toContain('確認番号')
    expect(deps.updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('無効なコードの応答は同一文言のまま。成立していないのでグループも引かない', async () => {
    const deps = makeLimboDeps({ findValidClaimCode: vi.fn().mockResolvedValue(null) })
    const res = await handleLimboGroupMessage(makeLimboParams(), deps)

    expect(res).toEqual({ claimCreated: false })
    expect(replies(deps)).toEqual([INVALID_TEXT])
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })

  it('コードでないふつうの発言には一切反応しない（未登録グループでは沈黙）', async () => {
    const deps = makeLimboDeps()
    const res = await handleLimboGroupMessage(makeLimboParams({ text: 'ヘルプ' }), deps)

    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
    expect(deps.updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('練習の配線が無くても、登録の成立そのものは今までどおり動く', async () => {
    const deps = makeLimboDeps({ findActiveGroup: undefined, updateGroupMetadata: undefined })
    const res = await handleLimboGroupMessage(makeLimboParams(), deps)

    expect(res).toEqual({ claimCreated: true })
    expect(replies(deps)).toEqual([CODE_ONLY_LINKED_TEXT])
  })

  it('練習の案内に失敗しても、登録の成立は巻き戻さない', async () => {
    const deps = makeLimboDeps({ findActiveGroup: vi.fn().mockRejectedValue(new Error('db down')) })
    const res = await handleLimboGroupMessage(makeLimboParams(), deps)

    expect(res).toEqual({ claimCreated: true })
    expect(replies(deps)).toEqual([CODE_ONLY_LINKED_TEXT])
  })
})

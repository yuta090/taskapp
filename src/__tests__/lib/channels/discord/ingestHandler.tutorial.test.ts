import { describe, it, expect, vi } from 'vitest'
import {
  handleDiscordIngest,
  CODE_ONLY_LINKED_TEXT,
  INVALID_TEXT,
  type DiscordIngestDeps,
  type DiscordIngestEvent,
} from '@/lib/channels/discord/ingestHandler'
import { buildAddTaskDoneText } from '@/lib/channels/groupCommands'
import {
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_COMPLETED_TEXT,
  TUTORIAL_SKIPPED_TEXT,
  buildTutorialAddedText,
} from '@/lib/channels/tutorial/messages'
import type { ChannelTutorialState } from '@/lib/channels/tutorial/state'

/**
 * Discord を代表に、登録直後の練習（対話型チュートリアル）の配線が端から端まで通っているかを見る。
 * 共通層（groupCommands / tutorial）の中身は別テストで見ているので、ここは「つながっているか」だけ。
 */

const ACCOUNT = { id: 'acc-discord-plat', botToken: 'bot-token' }
const NOW = new Date('2026-07-30T09:00:00.000Z')
const JUST_NOW = new Date(NOW.getTime() - 60_000).toISOString()

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
    insertMessage: vi.fn().mockResolvedValue({ id: 'row-1' }),
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
    createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', pending: false, duplicate: false }),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    assignDigestNumbersToNewTasks: vi
      .fn()
      .mockResolvedValue([{ id: 'task-9', digestNumber: 1, title: '秘書の使い方をおぼえる' }]),
    updateGroupMetadata: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  }
}

/** deps.reply は (botToken, channelId, text) の3引数。送った文章だけ取り出す。 */
function sentTexts(deps: DiscordIngestDeps): string[] {
  return (deps.reply as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2] as string)
}

function savedTutorial(deps: DiscordIngestDeps): ChannelTutorialState {
  const calls = (deps.updateGroupMetadata as ReturnType<typeof vi.fn>).mock.calls
  return (calls[calls.length - 1][1] as { tutorial: ChannelTutorialState }).tutorial
}

function activeGroup(metadata: Record<string, unknown> | null = null) {
  return { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1', createdAt: JUST_NOW, metadata }
}

describe('Discord: 登録直後の練習', () => {
  it('合言葉で登録できた直後に、成立の文言はそのままで、練習の入り口が届く', async () => {
    const findActiveGroup = vi
      .fn()
      // 1回目=登録前（未登録）、2回目=成立の見極め
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeGroup())
    const deps = makeDeps({
      findActiveGroup,
      normalizeClaimCode: vi.fn().mockReturnValue('CANONICAL'),
      findValidClaimCode: vi
        .fn()
        .mockResolvedValue({ id: 'lc', orgId: 'org-1', spaceId: 'space-1', bindingMode: 'code_only' }),
    })

    await handleDiscordIngest([event({ content: 'あいことば' })], deps)

    expect(sentTexts(deps)).toEqual([CODE_ONLY_LINKED_TEXT, TUTORIAL_INTRO_TEXT])
    expect(savedTutorial(deps)).toMatchObject({ step: 'awaiting_add' })
  })

  it('合言葉が違うときの応答は今までどおり同一文言で、練習も始まらない', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CANONICAL'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
    })

    await handleDiscordIngest([event({ content: 'まちがい' })], deps)

    expect(sentTexts(deps)).toEqual([INVALID_TEXT])
    expect(deps.updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('未登録チャンネルのふつうの発言には一切反応しない（沈黙）', async () => {
    const deps = makeDeps()
    await handleDiscordIngest([event({ content: 'ヘルプ' })], deps)

    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('練習中に「タスク追加 ○○」を送ると、預かった返事のあとに「完了1」の練習を案内する', async () => {
    const deps = makeDeps({
      findActiveGroup: vi
        .fn()
        .mockResolvedValue(
          activeGroup({ tutorial: { step: 'awaiting_add', startedAt: NOW.toISOString() } }),
        ),
    })

    await handleDiscordIngest([event({ content: 'タスク追加 秘書の使い方をおぼえる' })], deps)

    expect(sentTexts(deps)).toEqual([
      buildAddTaskDoneText('秘書の使い方をおぼえる'),
      buildTutorialAddedText(1, '秘書の使い方をおぼえる'),
    ])
    expect(savedTutorial(deps)).toMatchObject({ step: 'awaiting_done', taskId: 'task-9', digestNumber: 1 })
  })

  it('案内した番号を完了すると、締めの文が届いて練習が終わる', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(
        activeGroup({
          tutorial: {
            step: 'awaiting_done',
            taskId: 'task-9',
            digestNumber: 1,
            startedAt: NOW.toISOString(),
          },
        }),
      ),
      completeDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', title: '秘書の使い方をおぼえる' }),
    })

    await handleDiscordIngest([event({ content: '完了1' })], deps)

    expect(sentTexts(deps)[1]).toBe(TUTORIAL_COMPLETED_TEXT)
    expect(savedTutorial(deps)).toMatchObject({ step: 'finished' })
  })

  it('「あとで」で練習を切り上げられる', async () => {
    const deps = makeDeps({
      findActiveGroup: vi
        .fn()
        .mockResolvedValue(
          activeGroup({ tutorial: { step: 'awaiting_add', startedAt: NOW.toISOString() } }),
        ),
    })

    await handleDiscordIngest([event({ content: 'あとで' })], deps)

    expect(sentTexts(deps)).toEqual([TUTORIAL_SKIPPED_TEXT])
    expect(savedTutorial(deps)).toMatchObject({ step: 'finished' })
  })

  it('前からある接続（48時間より前に作られたチャンネル）では練習を始めない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({
        id: 'grp-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        createdAt: '2026-07-01T00:00:00.000Z',
        metadata: null,
      }),
    })

    await handleDiscordIngest([event({ content: 'おはようございます' })], deps)

    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.updateGroupMetadata).not.toHaveBeenCalled()
  })
})

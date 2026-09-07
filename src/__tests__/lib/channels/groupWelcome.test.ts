import { describe, it, expect, vi } from 'vitest'
import {
  buildGroupWelcomeText,
  sendGroupWelcome,
  type GroupWelcomeDeps,
  type GroupWelcomeTarget,
} from '@/lib/channels/groupWelcome'
import { TUTORIAL_PRACTICE_INVITE_TEXT } from '@/lib/channels/tutorial/messages'

/**
 * 相手先グループの接続が「社内の承認」で成立したときに、そのチャットへ1通だけ流す挨拶。
 *
 * その場で成立する経路（合言葉を投稿してすぐ繋がる）は限bo側で既に練習の入り口を出しているが、
 * 承認を挟む経路（Slack の自社アプリなど）は、承認してもチャット側が無言のままだった。
 * 相手先には AgentPM の画面が無いので、チャットに何も出ないと「入ったのかどうか」が分からない。
 */

const NOW = new Date('2026-09-08T01:00:00.000Z')

function makeTarget(over: Partial<GroupWelcomeTarget> = {}): GroupWelcomeTarget {
  return {
    groupId: 'grp-1',
    accountId: 'acc-1',
    orgId: 'org-1',
    spaceId: 'space-1',
    channel: 'slack',
    externalGroupId: 'C123',
    createdAt: NOW.toISOString(),
    metadata: null,
    ...over,
  }
}

function makeDeps(over: Partial<GroupWelcomeDeps> = {}): GroupWelcomeDeps {
  return {
    loadAccount: vi.fn().mockResolvedValue({
      ok: true,
      id: 'acc-1',
      ownerType: 'org',
      channel: 'slack',
      credentials: { bot_token: 'xoxb-1' },
      status: 'active',
    }),
    push: vi.fn().mockResolvedValue({ delivered: true }),
    saveTutorialState: vi.fn().mockResolvedValue(undefined),
    assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]),
    now: () => NOW,
    ...over,
  }
}

describe('buildGroupWelcomeText', () => {
  it('挨拶・打てる合図・練習の入り口を1通にまとめる', () => {
    const text = buildGroupWelcomeText('slack', { includePractice: true })
    expect(text).not.toBeNull()
    expect(text!).toContain('はじめまして')
    expect(text!).toContain('完了 3')
    expect(text!).toContain('タスク追加')
    expect(text!).toContain('ヘルプ')
    expect(text!).toContain(TUTORIAL_PRACTICE_INVITE_TEXT)
  })

  it('練習ができないときは練習の入り口を出さない', () => {
    const text = buildGroupWelcomeText('slack', { includePractice: false })
    expect(text!).not.toContain(TUTORIAL_PRACTICE_INVITE_TEXT)
    expect(text!).toContain('完了 3')
  })

  it('そのチャットだけの注意も落とさない（Chatwork の「返信」ボタン）', () => {
    const text = buildGroupWelcomeText('chatwork', { includePractice: true })
    expect(text!).toContain('返信')
  })

  it('使い方を持たないチャットでは null（＝何も送らない）', () => {
    expect(buildGroupWelcomeText('unknown_channel', { includePractice: true })).toBeNull()
  })
})

describe('sendGroupWelcome', () => {
  it('承認で成立したチャットへ1通送り、練習の状態も残す', async () => {
    const deps = makeDeps()
    const result = await sendGroupWelcome(makeTarget(), deps)

    expect(result).toEqual({ sent: true })
    expect(deps.push).toHaveBeenCalledTimes(1)
    const input = (deps.push as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(input.to).toBe('C123')
    expect(input.orgId).toBe('org-1')
    expect(input.text).toContain('はじめまして')
    expect(input.text).toContain(TUTORIAL_PRACTICE_INVITE_TEXT)
    // 二重送信よけ。承認ボタンの二度押し・HTTPリトライでも1通しか出さない
    expect(input.retryKey).toBe('group-welcome:grp-1')
    expect(input.record.groupId).toBe('grp-1')
    expect(deps.saveTutorialState).toHaveBeenCalledWith('grp-1', expect.objectContaining({ step: 'awaiting_add' }))
  })

  it('既に練習を案内済みのグループには、練習の入り口を出さない', async () => {
    const deps = makeDeps()
    await sendGroupWelcome(
      makeTarget({ metadata: { tutorial: { step: 'finished', startedAt: NOW.toISOString() } } }),
      deps,
    )
    const input = (deps.push as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(input.text).not.toContain(TUTORIAL_PRACTICE_INVITE_TEXT)
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })

  it('止めているアカウントには送らない', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({
        ok: true,
        id: 'acc-1',
        ownerType: 'org',
        channel: 'slack',
        credentials: { bot_token: 'xoxb-1' },
        status: 'disabled',
      }),
    })
    const result = await sendGroupWelcome(makeTarget(), deps)
    expect(result).toEqual({ sent: false, reason: 'account_disabled' })
    expect(deps.push).not.toHaveBeenCalled()
  })

  it('資格情報が読めないときは黙って諦める（承認そのものは壊さない）', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue({ ok: false, reason: 'decrypt_failed' }) })
    const result = await sendGroupWelcome(makeTarget(), deps)
    expect(result).toEqual({ sent: false, reason: 'decrypt_failed' })
    expect(deps.push).not.toHaveBeenCalled()
  })

  it('送信が抑止されたときは、その理由をそのまま返す', async () => {
    const deps = makeDeps({ push: vi.fn().mockResolvedValue({ delivered: false, reason: 'quota_suppressed' }) })
    const result = await sendGroupWelcome(makeTarget({ channel: 'line' }), deps)
    expect(result).toEqual({ sent: false, reason: 'quota_suppressed' })
  })
})

describe('送れなかったときの後始末', () => {
  it('送信が抑止されたら「案内済み」にしない（次の機会に練習へ誘える）', async () => {
    const deps = makeDeps({ push: vi.fn().mockResolvedValue({ delivered: false, reason: 'quota_suppressed' }) })
    await sendGroupWelcome(makeTarget({ channel: 'line' }), deps)
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })
})

import { getChannelCommandGuide } from '@/lib/channels/commandGuides'
import { TUTORIAL_PRACTICE_INVITE_TEXT } from '@/lib/channels/tutorial/messages'
import { startTutorial } from '@/lib/channels/tutorial/run'
import { readTutorialState, type ChannelTutorialState } from '@/lib/channels/tutorial/state'
import { getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'
import type { FindAccountForSecretaryPushResult } from '@/lib/channels/store'
import type { SendSecretaryPushInput, SendSecretaryPushResult } from '@/lib/channels/send/secretaryPush'

/**
 * 接続の承認が通った直後に、その相手先のチャットへ流す「はじめまして」。
 *
 * なぜ要るか: 合言葉をその場で読み取って繋がる経路（limbo）は、成立の返信のあとに練習の入り口を
 * 出している。ところが**社内の承認を挟む経路**（Slack の自社アプリなど）は、承認しても
 * チャット側が無言のままだった。相手先には AgentPM の画面が無いので、チャットに何も出ないと
 * 「秘書が入ったのか」「何を打てばいいのか」が誰にも分からない。
 *
 * 送るのは**1通だけ**。挨拶・打てる合図・練習の入り口をまとめる。通知を何度も鳴らさない。
 * 文言は書き写さず、使い方案内（commandGuides.ts）と練習（tutorial/messages.ts）の正本から組む。
 */

export interface GroupWelcomeTarget {
  groupId: string
  accountId: string
  orgId: string
  spaceId: string | null
  /** registry の ChannelId。使い方を持たないチャットには送らない */
  channel: string
  /** 送信先（Slackチャンネルid・LINEグループid など） */
  externalGroupId: string
  createdAt: string | null
  metadata: Record<string, unknown> | null
}

export interface GroupWelcomeDeps {
  loadAccount: (accountId: string) => Promise<FindAccountForSecretaryPushResult>
  push: (input: SendSecretaryPushInput) => Promise<SendSecretaryPushResult>
  saveTutorialState: (groupId: string, state: ChannelTutorialState) => Promise<void>
  assignDigestNumbersToNewTasks: (groupId: string) => Promise<Array<{ id: string; digestNumber: number; title: string }>>
  now: () => Date
}

export type GroupWelcomeResult = { sent: true } | { sent: false; reason: string }

/** 二重送信よけの鍵。承認ボタンの二度押し・HTTPリトライでも1通しか出さない。 */
export function groupWelcomeRetryKey(groupId: string): string {
  return `group-welcome:${groupId}`
}

/**
 * 挨拶の本文。`includePractice` は「練習をこれから始められるか」で呼び出し側が決める
 * （案内済みのグループに、もう一度練習を誘わないため）。
 */
export function buildGroupWelcomeText(
  channel: string,
  options: { includePractice: boolean },
): string | null {
  const guide = getChannelCommandGuide(channel)
  if (!guide) return null

  const commandLines = guide.commands.flatMap((command) => {
    const head = command.input ? `・${command.input} … ${command.effect}` : `・${command.effect}`
    return command.note ? [head, `　${command.note}`] : [head]
  })
  const limitationLines = guide.limitations.map((limitation) => `※${limitation}`)

  const blocks = [`はじめまして。${guide.summary}`, commandLines.join('\n'), limitationLines.join('\n')]
  if (options.includePractice) blocks.push(TUTORIAL_PRACTICE_INVITE_TEXT)
  return blocks.filter((block) => block.length > 0).join('\n\n')
}

/**
 * 承認で成立した接続に、挨拶を1通送る。
 *
 * 練習の状態は startTutorial に保存させるが、**その場では送らせない**（reply は何もしない）。
 * 誘い文句は本文にまとめて1通で出すため。startTutorial が null を返した＝練習できない
 * （使い方を持たないチャット・案内済み）ときは、挨拶から練習の入り口だけ落とす。
 *
 * 承認そのものは絶対に巻き戻さない。ここで送れなくても理由を返すだけにする。
 */
export async function sendGroupWelcome(
  target: GroupWelcomeTarget,
  deps: GroupWelcomeDeps,
): Promise<GroupWelcomeResult> {
  const account = await deps.loadAccount(target.accountId)
  if (!account.ok) return { sent: false, reason: account.reason }
  if (account.status !== 'active') return { sent: false, reason: 'account_disabled' }

  // 案内済みのグループを、承認のたびに練習へ誘い直さない
  const canPractice = !readTutorialState(target.metadata)
  const text = buildGroupWelcomeText(target.channel, { includePractice: canPractice })
  if (!text) return { sent: false, reason: 'no_guide' }

  const result = await deps.push({
    account: {
      id: account.id,
      ownerType: account.ownerType,
      channel: account.channel,
      credentials: account.credentials,
    },
    orgId: target.orgId,
    to: target.externalGroupId,
    text,
    retryKey: groupWelcomeRetryKey(target.groupId),
    jstDayOfYear: getJstDayOfYear(deps.now()),
    record: {
      spaceId: target.spaceId,
      identityId: null,
      groupId: target.groupId,
      externalUserId: null,
      body: text,
      payload: { kind: 'group_welcome' },
    },
  })
  if (!result.delivered) return { sent: false, reason: result.reason }

  // 練習の状態は「誘い文句が実際に届いてから」記録する。届く前に記録すると、
  // 送信が抑止されたグループが「案内済み」になり、練習の入り口を二度と出せなくなる。
  // 送るのは上で済ませたので、ここでの reply は何もしない（状態の保存だけさせる）。
  if (canPractice) {
    await startTutorial(
      {
        groupId: target.groupId,
        channel: target.channel,
        createdAt: target.createdAt,
        metadata: target.metadata,
      },
      {
        reply: async () => undefined,
        saveTutorialState: deps.saveTutorialState,
        assignDigestNumbersToNewTasks: deps.assignDigestNumbersToNewTasks,
        now: deps.now,
      },
    )
  }
  return { sent: true }
}

import type { DueReminderKind } from './dueReminderPlanner'
import {
  buildDueReminderDonePostbackData,
  buildDueReminderSnoozePostbackData,
} from './dueReminderPostback'

/**
 * 期限リマインドの文面（設計正本 §9・PR-1）＋確認Flex（§7・PR-2）。
 *
 * うざくない秘書 再設計（Fable+Codex一致裁定）: 「督促マシン」をやめ、私信(DM)=“問い”に統一する。
 * 旧版は ball='client'/'internal' で「催促をお願いします」等の命令調を出し分けていたが、
 * これは廃止した。宛先は常に内側担当者（tasks.assignee_id）であり、ball は宛先も文面も
 * 変えない（催促・対応いずれも本人への同じ丁寧な「問い」として届ける）。
 */

/** メッセージ層で扱う ball（tasks.ball の 'agency'/'vendor' は §9対象外・internal 扱いに丸める）。 */
export type DueReminderBall = 'client' | 'internal'

export interface BuildDueReminderTextInput {
  kind: DueReminderKind
  title: string
  /** 表示用（現行テンプレは日付文字列を直接埋め込まない。将来の文面変更に備えてシグネチャに残す） */
  dueDate?: string
}

const WHEN_LABEL: Record<'due_soon' | 'due_today', string> = {
  due_soon: '明日',
  due_today: '今日',
}

/**
 * kindから本文を組み立てる。overdue_confirm は「明日/今日」の区別が無い一本の文面。
 * うざくない秘書 再設計: 「（N回目の再通知です）」の表示は廃止した（反復回数を見せると
 * 督促の圧が増すため）。ballによる文面の出し分けも廃止（内側担当者への同一の「問い」）。
 */
export function buildDueReminderText(input: BuildDueReminderTextInput): string {
  const { kind, title } = input

  const headline =
    kind === 'overdue_confirm'
      ? `「${title}」の期限が過ぎています。`
      : `「${title}」が${WHEN_LABEL[kind]}期限です。`

  return [
    headline,
    '・完了済みでしたら、下の[完了した]を押してください。',
    '・まだの場合は、ご対応をお願いします。',
  ].join('\n')
}

/** スヌーズ日数の既定値（§7・open items §13は上限のみ未確定・日数は既定1日で確定）。 */
export const SNOOZE_DAYS = 1

export interface BuildDueReminderFlexInput {
  kind: DueReminderKind
  title: string
  taskId: string
  occurrenceId: string
  /** 表示用（現行テンプレは日付文字列を直接埋め込まない。将来の文面変更に備えてシグネチャに残す） */
  dueDate?: string
  /**
   * スヌーズ通番（occurrence.send_count）。本文には表示しない（うざくない秘書 再設計で
   * 「N回目の再通知」表示は廃止）が、snoozeボタンのpostback dataには引き続き
   * 「送信時の世代」として焼き込む（RPC側 p_expected_send_count と突き合わせ、旧世代Flexの
   * リプレイ/再送タップを弾くため・code review #2(HIGH)是正）。呼び出し側(sender)は必ず
   * claimしたoccurrenceのsend_countを渡す。
   */
  snoozeCount?: number
}

/**
 * 確認Flex（§7・PR-2）: 本文は buildDueReminderText と同一。
 * ボタン [完了した][対応中][明日また確認]（うざくない秘書 再設計。旧「まだ」「○日後に再通知」を統合）:
 *   - [完了した] → done postback（rpc_confirm_task_done_via_line。冪等なので世代不要）
 *   - [対応中] / [明日また確認] → 同一のsnooze postback（既定 SNOOZE_DAYS=1日後・
 *     送信時のsend_countを世代として同梱）。ラベルが違うだけで postback アクションは同一。
 */
export function buildDueReminderFlex(input: BuildDueReminderFlexInput): {
  type: 'flex'
  altText: string
  contents: {
    type: 'bubble'
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap: boolean }> }
    footer: { type: 'box'; layout: 'vertical'; contents: unknown[] }
  }
} {
  const { kind, title, taskId, occurrenceId, snoozeCount } = input
  const text = buildDueReminderText({ kind, title })
  const expectedSendCount = snoozeCount ?? 0
  const snoozeData = buildDueReminderSnoozePostbackData(occurrenceId, SNOOZE_DAYS, expectedSendCount)

  return {
    type: 'flex',
    altText: text,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text, wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'postback',
              label: '完了した',
              data: buildDueReminderDonePostbackData(taskId),
              displayText: '完了した',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '対応中',
              data: snoozeData,
              displayText: '対応中',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '明日また確認',
              data: snoozeData,
              displayText: '明日また確認',
            },
          },
        ],
      },
    },
  }
}

/**
 * channel-digest の期限セクション（§9・安全網v2・occurrence非依存）に載せる1件。
 * うざくない秘書 再設計: グループは「中立な予定表」に徹する（催促・ball文言は一切出さない）ため
 * ballは持たない。kindは既定オフセットの粒度([0,+1440]=当日/超過)に揃え due_soon(1日前)は
 * 対象外（dueReminderPlanner.DUE_REMINDER_OFFSETS_MINUTESの再設計と揃える）。
 */
export interface DueDigestItem {
  kind: 'due_today' | 'overdue_confirm'
  title: string
}

/** 1見出し(本日が期限/期限超過)あたりの表示上限。超過分は「ほかN件」に丸める（perf是正）。 */
const MAX_DUE_DIGEST_ITEMS_PER_SECTION = 10

/**
 * 1見出し分の行を積む。上限を超える件数は本文へ列挙せず「・ほかN件」の1行にまとめる
 * （perf是正: 未整理タスクが積み上がった事務所でdigest本文がLINE 5000字上限に張り付き、
 * digest全体のpushが失敗するのを防ぐ）。
 */
function pushDueDigestSectionLines(lines: string[], heading: string, sectionItems: DueDigestItem[]): void {
  if (sectionItems.length === 0) return
  lines.push(heading)
  const shown = sectionItems.slice(0, MAX_DUE_DIGEST_ITEMS_PER_SECTION)
  for (const item of shown) lines.push(`・${item.title}`)
  const rest = sectionItems.length - shown.length
  if (rest > 0) lines.push(`・ほか${rest}件`)
}

/**
 * digest本文に足す期限セクション（中立文面・§9）。対象0件なら空文字（呼び出し側は空欄を
 * 作らずそのまま無視できる）。todayJst は formatDateToLocalString(jstNow()) を渡す。
 *
 * うざくない秘書 再設計: 旧版は buildDueReminderText(kind×ball) を流用した催促寄りの文面
 * だったが、グループ全体へ出す「中立な予定表」に作り直した。完了サジェスト（タスク側の
 * 「完了」操作を促す共通の一文）は入れるが、ball起点の催促・命令調は一切出さない。
 */
export function buildDueDigestSectionText(items: DueDigestItem[], todayJst: string): string {
  if (items.length === 0) return ''

  const todayItems = items.filter((item) => item.kind === 'due_today')
  const overdueItems = items.filter((item) => item.kind === 'overdue_confirm')

  const lines = [
    `【期限のお知らせ】${todayJst}`,
    '完了済みのものは各タスクで「完了」に、未対応のものはご対応をお願いします。',
    '',
  ]

  pushDueDigestSectionLines(lines, '■ 本日が期限', todayItems)
  pushDueDigestSectionLines(lines, '■ 期限超過', overdueItems)

  return lines.join('\n')
}

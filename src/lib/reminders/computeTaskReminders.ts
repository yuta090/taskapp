/**
 * 時刻指定タスクリマインド（③ timed LINE reminders・pro以上限定）の純粋ロジック。
 * DB/時刻の副作用を持たず、cron route が集めたタスクと現在時刻を渡すだけで
 * 「今この瞬間に送るべきリマインド」を判定する。
 *
 * remind_at / remind_sent_at はいずれも絶対時刻（timestamptz）なので、日付成分の
 * 抽出は行わず getTime() 同士の比較のみ（JSTずれの心配がない領域）。
 */

export interface TaskReminderInput {
  id: string
  title: string
  spaceId: string
  dueDate: string | null // 'YYYY-MM-DD'（表示用）
  remindAt: string | null // ISO timestamp。設定されていれば送信対象候補
  remindSentAt: string | null // ISO timestamp。直近に送った時刻（未送信なら null）
  status: string
}

export interface SelectDueTaskRemindersInput {
  tasks: TaskReminderInput[]
  now: Date
}

/**
 * 送信対象タスクを選ぶ。条件:
 *  - remind_at が設定済みで now 以下（到来済み）
 *  - status が done でない
 *  - まだ送っていない（remind_sent_at が null）か、送信後に remind_at が
 *    先送りされた（remind_sent_at < remind_at ＝再アーム）
 *
 * DB クエリ側でも同等の絞り込みをするが、境界（ちょうど now・再アーム）を
 * 明示的に検証できるよう純粋関数として切り出す（二重送信防止の要）。
 */
export function selectDueTaskReminders(input: SelectDueTaskRemindersInput): TaskReminderInput[] {
  const nowMs = input.now.getTime()

  return input.tasks.filter((task) => {
    if (task.status === 'done') return false
    if (!task.remindAt) return false

    const remindAtMs = new Date(task.remindAt).getTime()
    if (Number.isNaN(remindAtMs)) return false
    if (remindAtMs > nowMs) return false // まだ到来していない

    if (task.remindSentAt) {
      const sentMs = new Date(task.remindSentAt).getTime()
      // 直近送信が今回の remind_at 以降なら送信済み。remind_at を先送りした場合のみ再送。
      if (!Number.isNaN(sentMs) && sentMs >= remindAtMs) return false
    }

    return true
  })
}

/**
 * LINE グループへ投稿するリマインド本文。秘書からの一言＋タスク名（＋期限）。
 */
export function buildTaskReminderText(task: TaskReminderInput): string {
  const lines = [`⏰ リマインド: ${task.title}`]
  if (task.dueDate) {
    lines.push(`期限: ${task.dueDate}`)
  }
  return lines.join('\n')
}

/**
 * 時刻指定タスクリマインド（③ timed reminders・pro以上限定・全チャネル）の純粋ロジック。
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
 * 配信先グループの絞り込み: 共有Bot（platform）を優先する。
 * 同一 space・同一チャネルに platform グループがあれば platform だけに配信し（org専用botとの
 * 二重配信を防ぐ）、無ければそのチャネルの全グループ（org専用bot）へフォールバックする
 * （platformを持たない従来型顧問先で無音の未送信になるのを防ぐ）。
 *
 * マルチチャネル化: 優先判定は **チャネルごと** に行う。LINEの共有Botがあるからといって
 * 同じ space に紐づく Slack/Discord 等のグループを落とさない（別チャネルには別々に届く）。
 * channel を持たない旧呼び出し元は全て同一チャネル扱い（従来挙動と同じ）。
 */
export function preferPlatformLinks<T extends { ownerType: string; channel?: string }>(links: T[]): T[] {
  const byChannel = new Map<string, T[]>()
  for (const link of links) {
    const key = link.channel ?? ''
    const list = byChannel.get(key) || []
    list.push(link)
    byChannel.set(key, list)
  }
  const result: T[] = []
  for (const group of byChannel.values()) {
    const platform = group.filter((l) => l.ownerType === 'platform')
    result.push(...(platform.length > 0 ? platform : group))
  }
  return result
}

/**
 * 相手先グループ（LINE/Slack等・全チャネル共通の床＝プレーンテキスト）へ投稿するリマインド本文。秘書からの一言＋タスク名（＋期限）。
 */
export function buildTaskReminderText(task: TaskReminderInput): string {
  const lines = [`⏰ リマインド: ${task.title}`]
  if (task.dueDate) {
    lines.push(`期限: ${task.dueDate}`)
  }
  return lines.join('\n')
}

/**
 * クライアント滞留リマインドの純粋な集計ロジック。
 * DB/時刻の副作用を持たず、呼び出し側（cron route）が集めたデータと
 * 現在時刻を渡すだけで、送信すべきダイジェスト一覧を計算する。
 *
 * JST日付・時刻の算出は toISOString() を使わない（プロジェクト規約: UTC変換で
 * 日本時間が1日ずれる実害があったため）。Intl.DateTimeFormat の Asia/Tokyo
 * タイムゾーン指定で 'YYYY-MM-DD' と時刻を取り出す。
 */

export type ReminderKind = 'overdue' | 'due_today' | 'stalled'

export interface ReminderTaskInput {
  id: string
  title: string
  spaceId: string
  spaceName: string
  dueDate: string | null // 'YYYY-MM-DD'
  ballSince: string // ISO timestamp（PASS_BALLイベント時刻 or updated_at）
  clientOwnerIds: string[] // 受信者候補（ルート側で解決済み）
}

export interface ReminderRecipient {
  userId: string
  email: string
  displayName: string | null
  remindersEnabled: boolean
}

export interface SentLogEntry {
  taskId: string
  recipientUserId: string
  kind: ReminderKind
  sentOn: string
  slot: number
}

export interface ReminderTaskRef {
  taskId: string
  title: string
  spaceName: string
  dueDate: string | null
  daysOverdue: number
}

export interface ReminderDigest {
  recipientUserId: string
  email: string
  displayName: string | null
  overdue: ReminderTaskRef[]
  dueToday: ReminderTaskRef[]
  stalled: ReminderTaskRef[]
}

export interface ComputeClientRemindersInput {
  tasks: ReminderTaskInput[]
  recipients: ReminderRecipient[]
  sentLogs: SentLogEntry[]
  now: Date
}

export interface ComputeClientRemindersResult {
  todayJst: string
  slot: number
  digests: ReminderDigest[]
  logEntries: SentLogEntry[]
}

const STALLED_THRESHOLD_MS = 72 * 60 * 60 * 1000

/**
 * JST での 'YYYY-MM-DD' を toISOString() を使わずに算出する。
 * cron route が client_reminder_log を今日分でクエリする際にも使う。
 */
export function getJstDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** JST での時 (0-23) を算出する */
export function getJstHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hourPart = parts.find((p) => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) : 0
}

/** JST時刻からスロットを算出。hour<12→0 / 12≤hour<16→1 / hour≥16→2 */
export function getSlot(hourJst: number): number {
  if (hourJst < 12) return 0
  if (hourJst < 16) return 1
  return 2
}

/** JSTの日付文字列同士の差分日数を算出（正=未来、負=過去） */
function diffJstDays(laterDateStr: string, earlierDateStr: string): number {
  const later = new Date(`${laterDateStr}T00:00:00Z`).getTime()
  const earlier = new Date(`${earlierDateStr}T00:00:00Z`).getTime()
  return Math.round((later - earlier) / (24 * 60 * 60 * 1000))
}

function classifyTask(
  task: ReminderTaskInput,
  todayJst: string,
  slot: number,
  now: Date
): { kind: ReminderKind; daysOverdue: number } | null {
  if (task.dueDate && diffJstDays(todayJst, task.dueDate) > 0) {
    // overdue: 全スロットで送る
    return { kind: 'overdue', daysOverdue: diffJstDays(todayJst, task.dueDate) }
  }

  if (slot !== 0) {
    // due_today / stalled は slot 0 のみ
    return null
  }

  if (task.dueDate && diffJstDays(todayJst, task.dueDate) === 0) {
    return { kind: 'due_today', daysOverdue: 0 }
  }

  // stalled: 期限なし、または未来の期限。ballSince から72時間以上経過で対象
  const ballSinceMs = new Date(task.ballSince).getTime()
  if (now.getTime() - ballSinceMs >= STALLED_THRESHOLD_MS) {
    return { kind: 'stalled', daysOverdue: 0 }
  }

  return null
}

export function computeClientReminders(
  input: ComputeClientRemindersInput
): ComputeClientRemindersResult {
  const { tasks, recipients, sentLogs, now } = input
  const todayJst = getJstDateString(now)
  const slot = getSlot(getJstHour(now))

  const recipientsByUserId = new Map(recipients.map((r) => [r.userId, r]))
  const sentSet = new Set(
    sentLogs.map((log) => `${log.taskId}:${log.recipientUserId}:${log.kind}:${log.sentOn}:${log.slot}`)
  )

  const digestsByRecipient = new Map<string, ReminderDigest>()
  const logEntries: SentLogEntry[] = []

  for (const task of tasks) {
    const classification = classifyTask(task, todayJst, slot, now)
    if (!classification) continue

    const { kind, daysOverdue } = classification

    for (const recipientUserId of task.clientOwnerIds) {
      const recipient = recipientsByUserId.get(recipientUserId)
      if (!recipient || !recipient.remindersEnabled) continue

      const dedupeKey = `${task.id}:${recipientUserId}:${kind}:${todayJst}:${slot}`
      if (sentSet.has(dedupeKey)) continue

      let digest = digestsByRecipient.get(recipientUserId)
      if (!digest) {
        digest = {
          recipientUserId,
          email: recipient.email,
          displayName: recipient.displayName,
          overdue: [],
          dueToday: [],
          stalled: [],
        }
        digestsByRecipient.set(recipientUserId, digest)
      }

      const taskRef: ReminderTaskRef = {
        taskId: task.id,
        title: task.title,
        spaceName: task.spaceName,
        dueDate: task.dueDate,
        daysOverdue,
      }

      if (kind === 'overdue') digest.overdue.push(taskRef)
      else if (kind === 'due_today') digest.dueToday.push(taskRef)
      else digest.stalled.push(taskRef)

      logEntries.push({ taskId: task.id, recipientUserId, kind, sentOn: todayJst, slot })
    }
  }

  return {
    todayJst,
    slot,
    digests: [...digestsByRecipient.values()],
    logEntries,
  }
}

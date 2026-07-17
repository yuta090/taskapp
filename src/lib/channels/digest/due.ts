import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * 申し送りの期限（日付＋時刻）の解決（Stage 2.6）。
 *
 * 日付は JST ローカルのまま扱う（`toISOString()` は使わない。UTC変換で1日ずれる・CLAUDE.md）。
 * 時刻は「明示されたときだけ」持つ。null = 終日。
 * 「午前中」「朝イチ」「夕方」のような曖昧語は時刻に丸めない（実際の締切ではなく、
 * 勝手に17:00等へ丸めるとリマインドが嘘をつくため）。
 */

export interface DueParts {
  /** YYYY-MM-DD（JST）。null = 期限なし */
  dueDate: string | null
  /** HH:MM（JST）。null = 終日 */
  dueTime: string | null
}

const NO_DUE: DueParts = { dueDate: null, dueTime: null }

/** LLMの年取り違え除け。基準日からこの日数より先の期限は採らない */
const MAX_FUTURE_DAYS = 180

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** 日曜=0 のインデックス。「金曜」「金」「Fri」等の表記ゆれは拾わず、日本語の曜日のみ扱う */
const WEEKDAY_INDEX: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function startOfDay(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate())
}

function addDays(base: Date, days: number): Date {
  const next = startOfDay(base)
  next.setDate(next.getDate() + days)
  return next
}

/** 週の起点は月曜。「来週火曜」が翌週の火曜を指すため、週境界を月曜で切る */
function startOfWeekMonday(base: Date): Date {
  const day = base.getDay()
  const offsetToMonday = day === 0 ? -6 : 1 - day
  return addDays(base, offsetToMonday)
}

/** 日付文字列(YYYY-MM-DD)をローカルDateに戻す。new Date('YYYY-MM-DD') はUTC解釈になるため使わない */
function parseLocalDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  // 2026-13-45 のような範囲外は Date が繰り上がるので、往復させて一致を確認する
  if (formatDateToLocalString(date) !== value) return null
  return date
}

function diffDays(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * 本文から期限日を解決する。解けなければ null。
 * 相対表現は `now`（JST基準日時）からの相対で絶対日付にする。
 */
function parseDueDate(body: string, now: Date): Date | null {
  // 絶対日付を優先する（「7/17」「7月17日」「2026年7月17日」）。明示された日付は相対語より確か
  const explicit =
    /(?:(\d{4})[年/])?(\d{1,2})[月/](\d{1,2})日?/.exec(body) ?? null
  if (explicit) {
    const [, yearRaw, monthRaw, dayRaw] = explicit
    const month = Number(monthRaw)
    const day = Number(dayRaw)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = yearRaw ? Number(yearRaw) : now.getFullYear()
      let resolved = new Date(year, month - 1, day)
      // 繰り上がり（2/31 等）は不正として捨てる
      if (resolved.getMonth() !== month - 1) return null
      // 年の指定がなく基準日より前なら翌年（年末に「1/5」と言われたケース）
      if (!yearRaw && diffDays(now, resolved) < 0) {
        resolved = new Date(year + 1, month - 1, day)
      }
      return resolved
    }
  }

  if (/明後日|あさって/.test(body)) return addDays(now, 2)
  if (/明日|あした|あす/.test(body)) return addDays(now, 1)
  if (/今日|本日|きょう/.test(body)) return startOfDay(now)

  // 「今週中」「来週中」は週の終端（金曜）に丸める。「今月中」「月内」「月末」は月末。
  // 「来月末」「来月」は翌月末（monthOffset を +1 する。無いと今月末を返す誤り）。
  const nextWeek = /来週/.test(body)
  const nextMonth = /来月/.test(body)
  if (nextMonth || /今月中|月内|月末/.test(body)) {
    const monthOffset = nextMonth ? 2 : 1
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 0)
  }
  if (/週中|週まで|週いっぱい/.test(body)) {
    const weekStart = startOfWeekMonday(now)
    const friday = addDays(weekStart, nextWeek ? 11 : 4)
    // 既に金曜を過ぎた週の「今週中」は当日締切とみなす（過去日を返さない）
    return diffDays(now, friday) < 0 ? startOfDay(now) : friday
  }

  const weekday = /([日月火水木金土])曜/.exec(body)
  if (weekday) {
    const target = WEEKDAY_INDEX[weekday[1]]
    if (nextWeek) {
      // 来週X曜 = 翌週（月曜起点）のX曜
      const nextWeekStart = addDays(startOfWeekMonday(now), 7)
      const offset = (target + 6) % 7 // 月曜起点でのオフセット（月=0 … 日=6）
      return addDays(nextWeekStart, offset)
    }
    // 修飾なしのX曜 = 次に来るX曜（当日を含む）
    const delta = (target - now.getDay() + 7) % 7
    return addDays(now, delta)
  }

  return null
}

/**
 * 本文から時刻を解決する。明示された時刻のみ。曖昧語（午前中・朝イチ・夕方）は null。
 */
function parseDueTime(body: string): string | null {
  const colon = /([01]?\d|2[0-3]):([0-5]\d)/.exec(body)
  if (colon) {
    const hour = Number(colon[1])
    return `${String(hour).padStart(2, '0')}:${colon[2]}`
  }

  if (/正午/.test(body)) return '12:00'

  // 「3時間かかる」の「時間」は所要時間であって締切ではない。時刻として拾わない
  const kanji = /(午前|午後)?\s*(\d{1,2})\s*時(?!間)(半|\s*(\d{1,2})\s*分)?/.exec(body)
  if (kanji) {
    const meridiem = kanji[1]
    let hour = Number(kanji[2])
    if (hour > 23) return null
    if (meridiem === '午後' && hour < 12) hour += 12
    if (meridiem === '午前' && hour === 12) hour = 0
    const minute = kanji[3] === '半' ? 30 : kanji[4] ? Number(kanji[4]) : 0
    if (minute > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  return null
}

/**
 * メンション即時タスク化（LLMを通さない経路）で使う日本語の期限パーサ。
 * 日付が取れなければ時刻も捨てる（時刻だけの期限は保持しない）。
 */
export function parseJapaneseDue(body: string, now: Date): DueParts {
  const date = parseDueDate(body, now)
  if (!date) return NO_DUE
  return validateDue(formatDateToLocalString(date), parseDueTime(body), now)
}

/**
 * LLM出力（および外部入力）の期限を検証する。保存前に必ず通す。
 * LLMは年を間違え、過去日を返す。壊れた期限はリマインドを嘘にするため黙って落とす。
 */
export function validateDue(
  dueDate: string | null,
  dueTime: string | null,
  now: Date,
): DueParts {
  if (typeof dueDate !== 'string') return NO_DUE

  const parsed = parseLocalDate(dueDate)
  if (!parsed) return NO_DUE

  const delta = diffDays(now, parsed)
  // 過去日は期限として無意味。遠すぎる日付は年の取り違えを疑う
  if (delta < 0 || delta > MAX_FUTURE_DAYS) return NO_DUE

  const validTime = typeof dueTime === 'string' && TIME_PATTERN.test(dueTime) ? dueTime : null
  return { dueDate, dueTime: validTime }
}

/**
 * digest配信の期限表示。期限なしは空文字（`⏰` ごと出さず、空欄を作らない）。
 * 期限超過は `⚠️` に変える。todayJst は formatDateToLocalString(new Date()) を渡す。
 */
export function formatDueLabel(
  dueDate: string | null,
  dueTime: string | null,
  todayJst: string,
): string {
  if (!dueDate) return ''
  const date = parseLocalDate(dueDate)
  const today = parseLocalDate(todayJst)
  if (!date || !today) return ''

  const delta = diffDays(today, date)
  const label = `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`

  if (delta < 0) return `⚠️${label} 期限超過`
  if (delta === 0) return dueTime ? `⏰今日 ${dueTime}` : '⏰今日'
  return dueTime ? `⏰${label} ${dueTime}` : `⏰${label}`
}

/**
 * 期限の緊急度でのソートキー。期限なしは最後（Number.MAX_SAFE_INTEGER）。
 * digest は毎朝openを全件送るため、期限順に並べること自体が「リマインド」になる。
 */
export function dueSortKey(dueDate: string | null, dueTime: string | null): number {
  if (!dueDate) return Number.MAX_SAFE_INTEGER
  const date = parseLocalDate(dueDate)
  if (!date) return Number.MAX_SAFE_INTEGER
  const [hour, minute] = (dueTime ?? '23:59').split(':').map(Number)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

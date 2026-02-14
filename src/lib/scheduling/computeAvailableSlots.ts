/**
 * 空き時間候補を算出するユーティリティ
 *
 * Googleカレンダーの busy データと営業時間を突合し、
 * 空いているスロットを返す。
 *
 * 注意: ブラウザのローカルタイムゾーンで計算する。
 * 日本向けB2B用途のため JST前提。
 */

export interface BusyPeriod {
  start: string // ISO 8601
  end: string   // ISO 8601
}

export interface AvailableSlot {
  startAt: string // "YYYY-MM-DDTHH:mm" (datetime-local 形式)
  endAt: string
  /** 曜日 (0=日, 1=月, ... 6=土) */
  dayOfWeek: number
  /** スロットが属する日付 "YYYY-MM-DD" (グルーピング用) */
  dateKey: string
}

export interface ComputeOptions {
  /** 対象開始日 (YYYY-MM-DD) */
  startDate: string
  /** 対象終了日 (YYYY-MM-DD) */
  endDate: string
  /** ミーティング所要時間（分） */
  durationMinutes: number
  /** 営業開始時刻 (時) default: 9 */
  businessHourStart?: number
  /** 営業終了時刻 (時) default: 18 */
  businessHourEnd?: number
  /** スロット間隔（分） default: 30 */
  stepMinutes?: number
  /** 最大結果数 default: 100 */
  maxResults?: number
}

/**
 * busy データから空きスロットを算出する。
 *
 * - 平日(月〜金)のみ
 * - 営業時間内のみ
 * - durationMinutes 分の枠が完全に空いている時間帯を返す
 *
 * @throws 不正な入力に対しては空配列を返す(ガード)
 */
export function computeAvailableSlots(
  busyPeriods: BusyPeriod[],
  options: ComputeOptions,
): AvailableSlot[] {
  const {
    startDate,
    endDate,
    durationMinutes,
    businessHourStart = 9,
    businessHourEnd = 18,
    stepMinutes = 30,
    maxResults = 100,
  } = options

  // --- ガードバリデーション ---
  if (durationMinutes <= 0 || stepMinutes <= 0 || maxResults <= 0) return []
  if (businessHourStart >= businessHourEnd) return []

  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return []
  if (start > end) return []

  // busy を ms タイムスタンプに変換してソート
  const busyMs = busyPeriods
    .map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }))
    .filter((b) => !isNaN(b.start) && !isNaN(b.end))
    .sort((a, b) => a.start - b.start)

  const results: AvailableSlot[] = []
  const durationMs = durationMinutes * 60 * 1000
  const stepMs = stepMinutes * 60 * 1000

  // 日付ループ
  const current = new Date(start)

  while (current <= end && results.length < maxResults) {
    const dayOfWeek = current.getDay()

    // 平日のみ (1=月 〜 5=金)
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const dayStart = new Date(current)
      dayStart.setHours(businessHourStart, 0, 0, 0)
      const dayEnd = new Date(current)
      dayEnd.setHours(businessHourEnd, 0, 0, 0)

      const dayStartMs = dayStart.getTime()
      const dayEndMs = dayEnd.getTime()
      const dateKey = toLocalDateOnly(current)

      // この日に重なるbusy区間だけフィルタ (R5: パフォーマンス改善)
      const dayBusy = busyMs.filter(
        (b) => b.start < dayEndMs && b.end > dayStartMs,
      )

      let slotStart = dayStartMs

      while (slotStart + durationMs <= dayEndMs && results.length < maxResults) {
        const slotEnd = slotStart + durationMs

        // busy と重複するか判定
        const overlaps = dayBusy.some(
          (b) => b.start < slotEnd && b.end > slotStart,
        )

        if (!overlaps) {
          results.push({
            startAt: toDatetimeLocal(new Date(slotStart)),
            endAt: toDatetimeLocal(new Date(slotEnd)),
            dayOfWeek,
            dateKey,
          })
        }

        slotStart += stepMs
      }
    }

    // 次の日
    current.setDate(current.getDate() + 1)
  }

  return results
}

/** "YYYY-MM-DD" → ローカル Date */
function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3) return new Date(NaN)
  const [y, m, d] = parts
  return new Date(y, m - 1, d)
}

/** Date → "YYYY-MM-DD" */
function toLocalDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Date → "YYYY-MM-DDTHH:mm" (datetime-local 互換) */
function toDatetimeLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

/** 曜日ラベル (日本語) */
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const
export function dayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? ''
}

/** datetime-local → 人間可読の日本語表記 "2/15(金) 10:00〜11:00" */
export function formatSlotLabel(startAt: string, endAt: string): string {
  const s = new Date(startAt)
  const e = new Date(endAt)
  const month = s.getMonth() + 1
  const day = s.getDate()
  const dow = dayLabel(s.getDay())
  const sh = String(s.getHours()).padStart(2, '0')
  const sm = String(s.getMinutes()).padStart(2, '0')
  const eh = String(e.getHours()).padStart(2, '0')
  const em = String(e.getMinutes()).padStart(2, '0')
  return `${month}/${day}(${dow}) ${sh}:${sm}〜${eh}:${em}`
}

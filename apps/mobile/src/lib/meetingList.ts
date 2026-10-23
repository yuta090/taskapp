/**
 * 会議の一覧の並べ方と表示の文字（純粋関数）。Web の会議一覧（MeetingRow・fetchMeetingsQuery）に合わせる。
 */
import type { Meeting, MeetingStatus } from '@/types/database'

/** 並べる基準の時刻。開催日時が無い会議は作った日時 */
function sortKey(m: Meeting): string {
  return m.held_at || m.created_at || ''
}

/** 新しい順。同じ時刻は id の降順（Web の一覧と同じタイブレーク） */
export function buildMeetingList(meetings: Meeting[]): Meeting[] {
  return [...meetings].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    if (ka !== kb) return ka < kb ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/** 状態の文字。Web の MeetingRow と同じ（in_progress=進行中・ended=終了・それ以外=予定） */
export function meetingStatusLabel(status: MeetingStatus): string {
  if (status === 'in_progress') return '進行中'
  if (status === 'ended') return '終了'
  return '予定'
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
/** JST は UTC+9 固定（サマータイムなし）。端末のタイムゾーンに依らず日本時間で出す */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * 日本時間の「10月3日（土）14:00」。時刻が 0:00 のときは日付だけ。読めない・無いときは空文字。
 * toISOString は使わない（UTC で1日ずれるため）。JST へずらした Date の UTC 成分を読む。
 */
export function formatMeetingDate(heldAt: string | null): string {
  if (!heldAt) return ''
  const t = new Date(heldAt).getTime()
  if (Number.isNaN(t)) return ''
  const d = new Date(t + JST_OFFSET_MS)
  const date = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  if (h === 0 && m === 0) return date
  return `${date}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

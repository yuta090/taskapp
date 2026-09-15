import { jstNow } from '@/lib/datetime/jstNow'

/**
 * 会議メモに残す「書いた日時」と「書いた人」の読み書き。
 *
 * 日時の保存の形は `2026-09-15T14:30`（日本時間の壁時計。時差の表記は付けない）。
 * 議事録の本文（Markdown）の中に置くので、人が見ても読める形にしておく。
 */

/** 日時の形。この形でなければ「日時なし」として扱う。 */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 今の日時を、会議メモに残す形にする。
 *
 * 本番（Vercel）は時差の設定が UTC なので、そのまま `new Date()` を使うと
 * 朝の時間帯に日付が1日ずれる。`jstNow()` を挟んで日本時間の成分にしてから組み立てる。
 */
export function formatNoteStamp(jstDate?: Date, now: Date = new Date()): string {
  const d = jstDate ?? jstNow(now)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 「今が何年か」だけを少しの間だけ覚えておく。
 *
 * `jstNow()` は中で `Intl.DateTimeFormat` を作り直すので、会議メモの数だけ呼ぶと
 * じわじわ効く（会議メモ100件で約6ミリ秒、2000件で約97ミリ秒を実測）。使うのは年だけで、
 * 年はそう変わらないので、1分だけ使い回す。
 */
const YEAR_CACHE_MS = 60_000
let cachedYear: { value: number; at: number } | null = null

function currentJstYear(): number {
  const now = Date.now()
  if (cachedYear && now - cachedYear.at < YEAR_CACHE_MS) return cachedYear.value
  const value = jstNow().getFullYear()
  cachedYear = { value, at: now }
  return value
}

/**
 * 画面に出す短い日時。同じ年なら `9/15 14:30`、年が違えば `2025/12/3 9:05`。
 * 年をいつも出すと長くて本文の邪魔になるが、去年のメモで月日だけだと迷うため。
 *
 * 形が違うもの・空のものは null（何も出さない）。
 */
export function formatNoteStampLabel(stamp: string | undefined, today?: Date): string | null {
  if (!stamp) return null
  const m = STAMP_RE.exec(stamp)
  if (!m) return null
  const [, year, month, day, hour, minute] = m
  const sameYear = Number(year) === (today ? today.getFullYear() : currentJstYear())
  const date = `${Number(month)}/${Number(day)}`
  const time = `${Number(hour)}:${minute}`
  return sameYear ? `${date} ${time}` : `${year}/${date} ${time}`
}

/** 書いた人の名前の長さの上限。長い名前は本文の横で邪魔になるので切る */
const NOTE_AUTHOR_MAX_CHARS = 40

/**
 * 書いた人の名前を、本文の目印に置ける形に整える。
 *
 * 名前は `<!--note:2026-09-15T14:30 高橋 優太-->` のように目印の中に入るので、`>` があると
 * 目印がそこで閉じてしまう。`<` と `>` を落とし、改行やタブは空白1つにまとめる
 * （目印は1行に収める約束）。無いときは空文字。
 */
export function normalizeNoteAuthor(name: string | null | undefined): string {
  if (!name) return ''
  const cleaned = name.replace(/[<>]/g, '').replace(/[\p{Cc}\s]+/gu, ' ').trim()
  // 絵文字などを途中で割らないよう、文字単位で数える
  return Array.from(cleaned).slice(0, NOTE_AUTHOR_MAX_CHARS).join('').trim()
}

/**
 * メンバー一覧（`useSpaceMembers`）から、メモに残す自分の名前を引く。
 *
 * 一覧は表示名が未設定の人に `id の先頭8文字...` という仮の名前を入れて返す。これを本文に
 * 焼き付けると意味の無い文字が残り続けるので、名前が無いものとして扱う。
 */
export function noteAuthorNameOf(
  members: ReadonlyArray<{ id: string; displayName: string }>,
  userId: string | null | undefined
): string {
  if (!userId) return ''
  const displayName = members.find((member) => member.id === userId)?.displayName ?? ''
  if (displayName === `${userId.slice(0, 8)}...`) return ''
  return normalizeNoteAuthor(displayName)
}

/**
 * タスクのコメントで「@で名前を選ぶ」まわりの純粋関数。
 *
 * DOM やネットワークに触れない形にして、TaskComments.tsx から切り離してテストする。
 * 誰を候補にするか・どこまでを実際に保存するかの規則はすべてここに置く
 * （画面側は「入力された文字列」「選んだ人」を渡すだけにする）。
 */

import type { SpaceMember } from '@/lib/hooks/useSpaceMembers'
import { INTERNAL_SPACE_ROLES } from '@/lib/roles/spaceRoles'
import type { CommentVisibility } from '@/types/database'

/** 1件のコメントで名指しできる上限人数 */
export const MAX_MENTION_COUNT = 20

/**
 * コメントの公開範囲ごとに、@候補へ出してよい役割。
 * - internal（社内のみ） → 社内の役割だけ
 * - client（外部に公開） → 社内 + クライアント
 * - vendor（ベンダー向け） → 社内 + ベンダー
 * - agency_only は今回の対象外の組み合わせなので、安全側に倒して社内のみにする
 *   （用途が固まったら、ここに 1 行足す）
 */
const MENTION_ALLOWED_ROLES: Record<CommentVisibility, readonly string[]> = {
  internal: INTERNAL_SPACE_ROLES,
  client: [...INTERNAL_SPACE_ROLES, 'client'],
  vendor: [...INTERNAL_SPACE_ROLES, 'vendor'],
  agency_only: INTERNAL_SPACE_ROLES,
}

export interface MentionCandidateOptions {
  visibility: CommentVisibility
  currentUserId: string | null
  /** @ の直後に入力中の文字。空/未指定なら絞り込まない */
  query?: string
}

/**
 * @候補の一覧を返す。見える範囲の役割だけに絞り、自分は除く。
 * query があれば、表示名の完全一致 → 前方一致 → 部分一致の順に並べる
 * （候補が開いている間の Enter は先頭を選ぶので、「@山田」で山田太郎さんが先に来ないようにする）。
 */
export function getMentionCandidates(
  members: readonly SpaceMember[],
  { visibility, currentUserId, query }: MentionCandidateOptions
): SpaceMember[] {
  const allowedRoles = MENTION_ALLOWED_ROLES[visibility] ?? INTERNAL_SPACE_ROLES
  const pool = members.filter(
    (m) => m.id !== currentUserId && allowedRoles.includes(m.role)
  )

  const trimmed = (query ?? '').trim().toLowerCase()
  if (!trimmed) return pool

  const rank = (m: SpaceMember): number => {
    const name = m.displayName.toLowerCase()
    if (name === trimmed) return 0
    if (name.startsWith(trimmed)) return 1
    if (name.includes(trimmed)) return 2
    return -1
  }
  const ranked = pool.map((m) => ({ m, r: rank(m) })).filter((x) => x.r >= 0)
  // Array.prototype.sort は安定なので、同じ順位の中では名簿の順を保つ
  return ranked.sort((a, b) => a.r - b.r).map((x) => x.m)
}

export interface MentionQuery {
  /** テキスト中の "@" の位置 */
  start: number
  /** "@" の直後から今のカーソル位置までの文字列 */
  query: string
}

/**
 * テキストとカーソル位置から、今まさに入力中の @ 検索語を取り出す。
 * "@"（全角 "＠" も可）の直前が英数字・"."・"_"・"-" のときだけ検出しない
 * （メールアドレスの途中などでの誤検出を防ぐにはこれで足りる）。
 * 句読点・括弧・全角文字の直後や行頭は検出してよい。該当が無ければ null。
 */
export function detectMentionQuery(text: string, cursorPos: number): MentionQuery | null {
  const before = text.slice(0, cursorPos)
  const match = before.match(/[@＠]([^\s@＠]*)$/)
  if (!match) return null

  const start = cursorPos - match[0].length
  const precedingChar = start > 0 ? before[start - 1] : ''
  if (/[A-Za-z0-9._-]/.test(precedingChar)) return null

  return { start, query: match[1] }
}

export interface MentionSelection {
  id: string
  displayName: string
}

/**
 * 送信時に、実際に保存する mention の ID を確定する。
 * - 選んだ人のうち、本文に "@表示名" がまだ残っている人だけを残す（消したら通知しない）
 * - 見える範囲の外に落ちた人（公開範囲を変えた等）は落とす
 * - 本文は左から走査し、表示名は長いものから照合して文字の範囲を使い切る
 *   （splitCommentBody と同じやり方。短い名前が長い名前の一部として誤って
 *   数えられないようにする。例: 「@山田太郎」を「@山田」+残りとして数えない）
 * - 同じ表示名の人が複数選ばれているとき（例: 別人の「佐藤」を選び直した）は、
 *   本文に "@表示名" が出てくる回数までを、後から選んだ人から順に確定する
 *   （選んだ一覧は本文から消しても減らないので、先に選んで消した人を残さない）
 * - 照合に使う名前は、選んだ人だけでなく見える範囲の全員の表示名にする
 *   （「@山田」を選んだあと手で「太郎」を足して「@山田太郎」にしたら、山田さんには届けない）
 * - 重複は除き、最大 MAX_MENTION_COUNT 件まで
 * 既知の制限: 同じ表示名の2人を両方選んだあと片方の「@表示名」を本文から消すと、本文の位置ではなく
 * 選んだ順で決めるため、残したつもりの人ではなく後から選んだ人に届く（同名の2人を同じコメントで呼ぶ場面に限る）。
 */
export function resolveMentionUserIds(
  body: string,
  selected: readonly MentionSelection[],
  allowedCandidates: readonly SpaceMember[]
): string[] {
  const allowedIds = new Set(allowedCandidates.map((m) => m.id))
  const visible = selected.filter((s) => allowedIds.has(s.id))
  if (visible.length === 0) return []

  // 本文に実際に残っている "@表示名" の数を、見える範囲の全員の名前で長いものから数える
  const uniqueNames = Array.from(
    new Set([...allowedCandidates.map((m) => m.displayName), ...visible.map((s) => s.displayName)])
  )
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length)

  const occurrenceCount = new Map<string, number>()
  let i = 0
  while (i < body.length) {
    const match = uniqueNames.find((name) => body.startsWith(`@${name}`, i))
    if (match) {
      occurrenceCount.set(match, (occurrenceCount.get(match) ?? 0) + 1)
      i += match.length + 1
    } else {
      i += 1
    }
  }

  // 表示名ごとに選んだ順を保ったまま集め、後から選んだ人を優先して
  // 本文に残っている数だけ確定する
  const byName = new Map<string, MentionSelection[]>()
  for (const s of visible) {
    const list = byName.get(s.displayName)
    if (list) {
      list.push(s)
    } else {
      byName.set(s.displayName, [s])
    }
  }

  const confirmed: MentionSelection[] = []
  for (const [name, list] of byName) {
    const remaining = occurrenceCount.get(name) ?? 0
    if (remaining === 0) continue
    confirmed.push(...list.slice(Math.max(0, list.length - remaining)))
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const s of confirmed) {
    if (result.length >= MAX_MENTION_COUNT) break
    if (seen.has(s.id)) continue
    seen.add(s.id)
    result.push(s.id)
  }

  return result
}

export type CommentBodySegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; userId: string }

/**
 * 保存済みコメントの本文を、ふつうの文字と "@表示名"（mentionUserIds の人）に分ける。
 * 表示専用（TaskComments のコメント一覧）。
 */
export function splitCommentBody(
  body: string,
  mentionUserIds: readonly string[],
  members: readonly SpaceMember[]
): CommentBodySegment[] {
  if (!body) return []
  if (mentionUserIds.length === 0) return [{ type: 'text', value: body }]

  const nameById = new Map(members.map((m) => [m.id, m.displayName]))
  const tokens = mentionUserIds
    .map((id) => ({ id, text: `@${nameById.get(id) ?? ''}` }))
    .filter((t) => t.text.length > 1)
    // 長い名前を優先して探す（短い名前が長い名前の一部にならないように）
    .sort((a, b) => b.text.length - a.text.length)

  const segments: CommentBodySegment[] = []
  let buffer = ''
  let i = 0

  while (i < body.length) {
    const match = tokens.find((t) => body.startsWith(t.text, i))
    if (match) {
      if (buffer) {
        segments.push({ type: 'text', value: buffer })
        buffer = ''
      }
      segments.push({ type: 'mention', value: match.text, userId: match.id })
      i += match.text.length
    } else {
      buffer += body[i]
      i += 1
    }
  }

  if (buffer) segments.push({ type: 'text', value: buffer })
  return segments
}

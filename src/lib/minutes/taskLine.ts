import { jstNow } from '@/lib/datetime/jstNow'
import { buildWikiPageHref } from '@/lib/navigation/appLinks'
import type { MinutesBlock, MinutesInlineContent } from '@/lib/minutes/markdown'

/**
 * 「タスクにする行」を組み立てる。
 *
 * 議事録の行は書き方でタスクの中身が決まるが、その書き方（期限の形・資料の差し込み方）を
 * 覚えてもらうのは無理がある。画面で選んでもらった中身から、**必ず読み取れる形の1行**を
 * こちらで作る。
 */

/** 画面で選んでもらう中身。 */
export interface TaskLineDraft {
  /** やること。これがタスクの名前になる */
  title: string
  /** 期限。`YYYY-MM-DD`（日付の入力欄が返す形）。空なら期限なし */
  due?: string
  /** 資料にする Wiki ページ */
  page?: { id: string; title: string }
}

const DUE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 期限の見せ方。同じ年なら `9/20`、年が違えば `2027/1/5`。
 * 本文に書く文字もこの形で、DB 側が `期限:\s*(\d+/\d+(?:/\d+)?)` で読み取る。
 */
export function formatDueLabel(due: string | undefined, today: Date = jstNow()): string | null {
  if (!due) return null
  const m = DUE_INPUT_RE.exec(due)
  if (!m) return null
  const [, year, month, day] = m
  const md = `${Number(month)}/${Number(day)}`
  return Number(year) === today.getFullYear() ? md : `${year}/${md}`
}

function text(value: string): MinutesInlineContent {
  return { type: 'text', text: value, styles: {} }
}

/**
 * 1行ぶんのブロックを作る。やることが空なら null。
 *
 * できる形は `- [ ] やること [ページ名](ページへの道) （期限: 9/20）`。
 * 期限は**いちばん最後**に置く。DB 側は行のどこにあっても読み取るが、題名を組み立てる
 * ときに末尾から外すので、途中に入れると読みにくい題名になる。
 */
export function buildTaskLineBlock(
  draft: TaskLineDraft,
  orgId: string,
  spaceId: string,
  today: Date = jstNow()
): MinutesBlock | null {
  const title = draft.title.trim()
  if (title === '') return null

  const content: MinutesInlineContent[] = [text(title)]

  if (draft.page) {
    content.push(text(' '))
    content.push({
      type: 'link',
      href: buildWikiPageHref(orgId, spaceId, draft.page.id),
      content: [{ type: 'text', text: draft.page.title, styles: {} }],
    })
  }

  const dueLabel = formatDueLabel(draft.due, today)
  if (dueLabel) content.push(text(`（期限: ${dueLabel}）`))

  return { type: 'checkListItem', props: { checked: false }, content }
}

/** 入れ子を持てる、最小限のブロックの形（BlockNote の `editor.document` を受けられる）。 */
interface NestedBlock {
  id?: string
  children?: readonly NestedBlock[]
}

function contains(block: NestedBlock, id: string): boolean {
  if (block.id === id) return true
  return (block.children ?? []).some((child) => contains(child, id))
}

/**
 * カーソルのある行を含む、**いちばん外側の行**を探す。
 *
 * タスクにする行は字下げされていると候補に出ない（DB 側は行頭の `- [ ]` だけを見る）。
 * 折りたたみや箇条書きの中で押されたときに、そのまま隣へ入れると字下げされてしまうので、
 * その大元の行の後ろに入れる。見つからなければ文書の最後に足す。
 */
export function findTopLevelAncestor(
  blocks: readonly NestedBlock[],
  cursorBlockId: string | undefined
): NestedBlock | null {
  if (blocks.length === 0) return null
  const last = blocks[blocks.length - 1]
  if (!cursorBlockId) return last
  return blocks.find((block) => contains(block, cursorBlockId)) ?? last
}

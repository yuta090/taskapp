/**
 * 同時編集で、誰のカーソルかを見分けるための色。
 *
 * 色は必ずトークン（`globals.css` の `@theme`）から取る。値を直に書くと、暗い配色に
 * したときだけ読めない色になる。**アンバー/オレンジは使わない** — あの色は「相手先に
 * 見える」印に取ってあるので、人の色に使うと意味が混ざる。
 *
 * 人数の上限（6人）ぶん用意し、user id から決める。同じ人はいつも同じ色になる。
 */
const CURSOR_COLORS = [
  'var(--color-indigo-500)',
  'var(--color-blue-500)',
  'var(--color-green-600)',
  'var(--color-indigo-600)',
  'var(--color-blue-600)',
  'var(--color-green-500)',
]

export function cursorColorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length]
}

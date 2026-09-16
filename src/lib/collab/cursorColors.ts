/**
 * 同時編集で、誰のカーソルかを見分けるための色。
 *
 * 色は画面のトークン（`globals.css` の `@theme`）を正本にし、**使うときに実際の値へ
 * 読み替える**。カーソルを描く部品は `#RRGGBB` の形しか読めず、`var(--color-…)` を
 * そのまま渡すと、名前の文字色の判定（背景の明るさから白か黒かを決める）と選択範囲の
 * 色づけ（値の後ろに透明度を足す）が壊れる。控えの値は、読めなかったときだけ使う。
 *
 * **アンバー/オレンジは使わない** — あの色は「相手先に見える」印に取ってあるので、
 * 人の色に使うと意味が混ざる。
 *
 * 何番の色を使うかは部屋の中で決める（`colorIndexOf`）。人ごとにハッシュで選ぶと、
 * 運が悪いと2人が同じ色になり、どちらが書いているのか分からなくなる。
 */
interface CursorColor {
  /** 画面のトークン名。こちらが正本 */
  token: string
  /** トークンが読めなかったときの控え。トークンと同じ値にしておく */
  fallback: string
}

const CURSOR_COLORS: CursorColor[] = [
  { token: '--color-indigo-500', fallback: '#6366f1' },
  { token: '--color-green-600', fallback: '#16a34a' },
  { token: '--color-blue-500', fallback: '#3b82f6' },
  { token: '--color-indigo-600', fallback: '#4f46e5' },
  { token: '--color-green-500', fallback: '#22c55e' },
  { token: '--color-blue-600', fallback: '#2563eb' },
]

/** 用意してある色の数。同時に入れる人数の上限（6）と合わせてある */
export const CURSOR_COLOR_COUNT = CURSOR_COLORS.length

const HEX = /^#[0-9a-fA-F]{6}$/

/** 何番目の色か。番号が範囲の外でも必ずどれかに収める */
export function cursorColorAt(index: number): string {
  const size = CURSOR_COLORS.length
  const entry = CURSOR_COLORS[((index % size) + size) % size]
  if (typeof document === 'undefined') return entry.fallback
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(entry.token).trim()
    return HEX.test(value) ? value : entry.fallback
  } catch {
    return entry.fallback
  }
}

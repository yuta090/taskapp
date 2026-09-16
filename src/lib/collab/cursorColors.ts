/**
 * 同時編集で、誰のカーソルかを見分けるための色。
 *
 * **番号は部屋に入ったときに決めて、以後は変えない。** カーソルを描く部品は相手ごとに
 * 札を1回だけ作って使い回すので、あとから色を変えても相手の画面には届かない
 * （帯だけ新しい色になり、カーソルは古い色のまま残る）。
 *
 * 値は `#RRGGBB` で渡す。部品は背景の明るさを測って名前の文字色を白か黒に決めており、
 * `var(--color-…)` のままでは読めない。選択範囲の帯も値の後ろに透明度を足すので同じ。
 * そこで**トークンを正本にしたまま、使うときに実際の値へ読み替える**。
 *
 * 色は `globals.css` の `--color-cursor-1〜6`。アンバー/オレンジは「相手先に見える」印、
 * 赤は失敗の印なので使わない。いまダークで色を反転していないので読み替えは1回でよいが、
 * 将来反転させるなら、切り替えを見て入れ直す仕組みが要る（部品の札の作り直しも含めて）。
 */
interface CursorColor {
  /** 画面のトークン名。こちらが正本 */
  token: string
  /** トークンが読めなかったときの控え。`globals.css` と同じ値にしておく（テストが検査） */
  fallback: string
}

const CURSOR_COLORS: CursorColor[] = [
  { token: '--color-cursor-1', fallback: '#6366F1' },
  { token: '--color-cursor-2', fallback: '#059669' },
  { token: '--color-cursor-3', fallback: '#0EA5E9' },
  { token: '--color-cursor-4', fallback: '#7C3AED' },
  { token: '--color-cursor-5', fallback: '#0D9488' },
  { token: '--color-cursor-6', fallback: '#C026D3' },
]

/** 用意してある色の数。同時に入れる人数の上限（6）と合わせてある */
export const CURSOR_COLOR_COUNT = CURSOR_COLORS.length

const HEX = /^#[0-9a-fA-F]{6}$/

function entryAt(index: number): CursorColor {
  const size = CURSOR_COLORS.length
  return CURSOR_COLORS[((index % size) + size) % size]
}

/**
 * 何番目の色か（控えの値）。**描画の途中でも呼べる**。
 * 画面を測らないので、エディタを載せるときはこちらを使う。
 */
export function cursorFallbackAt(index: number): string {
  return entryAt(index).fallback
}

/**
 * 何番目の色か（画面のトークンから読み替えた値）。
 * 画面を測るので、**描画が終わったあと（effect の中）で呼ぶ**。
 */
export function cursorColorAt(index: number): string {
  const entry = entryAt(index)
  if (typeof document === 'undefined') return entry.fallback
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(entry.token).trim()
    return HEX.test(value) ? value : entry.fallback
  } catch {
    return entry.fallback
  }
}

/** 控えの値の一覧（トークンと食い違っていないかを検査するために出す） */
export const CURSOR_COLOR_TOKENS: readonly CursorColor[] = CURSOR_COLORS

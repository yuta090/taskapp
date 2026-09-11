/**
 * ページ移動によってブラウザが打ち切った読み込み（net::ERR_ABORTED 相当）かどうかを判定する。
 *
 * ログイン直後など、移り先の画面がまだ読み込み中のうちに別の画面へフル移動すると、
 * そのとき進行中だった fetch がブラウザに打ち切られ、`AbortError` や
 * `TypeError: Failed to fetch`（Safari は `Load failed`）として reject される。
 * これは通信障害ではなく利用者への実害も無いため、console.error でエラー記録しない対象にする。
 * それ以外の本当の通信失敗（ページ移動と無関係な失敗）は今までどおりエラーとして扱う。
 *
 * 判定の材料は2つ:
 * - `AbortError`（AbortController.abort() 経由）は、ページ移動していなくても常に打ち切り扱い。
 * - `pagehide` / `beforeunload` が発火した“後”に失敗した fetch 系エラー
 *   （AbortError にならない実装のブラウザもあるため、時間的な文脈で補う）。
 *
 * 注意: `AbortError` は理由を問わず（タイムアウトでの自前 abort でも）打ち切り扱いになる。
 * 呼び出し元が自分で `AbortController.abort()` するケース（タイムアウト等）ではこの関数を
 * 使わない — 本当の失敗までページ移動の打ち切りとして握り潰してしまう。
 *
 * イベント登録はブラウザでのみ行う（SSR で window に触らない）。
 */

// beforeunload は「移動を止める」（確認ダイアログでキャンセル等）とページに留まることがあり、
// その場合は pagehide も pageshow も発火しないため、boolean の旗だと立ちっぱなしになる。
// 時刻だけ記録し、直近 BEFOREUNLOAD_WINDOW_MS 以内だけ「離脱中」とみなすことで自然に失効させる。
const BEFOREUNLOAD_WINDOW_MS = 5_000

let pageHidden = false
let beforeUnloadAt: number | null = null

function markPageHidden(): void {
  pageHidden = true
}

// 「戻る」で bfcache から画面が丸ごと復元されると発火する。ここで旗を下ろさないと、
// 復元後の画面で起きた本当の通信障害まで打ち切り扱いになり記録されなくなってしまう
function markPageShown(): void {
  pageHidden = false
}

function markBeforeUnload(): void {
  beforeUnloadAt = Date.now()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', markPageHidden)
  window.addEventListener('pageshow', markPageShown)
  window.addEventListener('beforeunload', markBeforeUnload)
}

function isLeavingPage(): boolean {
  if (pageHidden) return true
  return beforeUnloadAt !== null && Date.now() - beforeUnloadAt < BEFOREUNLOAD_WINDOW_MS
}

// message はネイティブの Error/TypeError（.message）と、supabase-js（postgrest-js）が
// fetch の失敗を包み直した `{ message: 'TypeError: Failed to fetch', code: '', hint: '' }`
// のような素のオブジェクトの両方から拾えるようにする（本番でこの経路の失敗が実際にこの形で来る）
function messageOf(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; code?: unknown }
  if (e.name === 'AbortError') return true
  if (e.code === 'ABORT_ERR') return true
  return /^AbortError:/.test(messageOf(err) ?? '')
}

// ブラウザ実装ごとの「fetch が打ち切られた/失敗した」ときのメッセージ。
// "operation was aborted" は @supabase/auth-js の AuthRetryableFetchError 経由のケース向け:
// 同ライブラリは name を必ず 'AuthRetryableFetchError' に潰してしまい元の AbortError の
// name が失われるため、message でしか見分けられない（=常時ではなく離脱中に限定して判定）
const FETCH_FAILURE_MESSAGE =
  /Failed to fetch|Load failed|NetworkError when attempting to fetch resource|operation was aborted/i

function isFetchFailureLike(err: unknown): boolean {
  return FETCH_FAILURE_MESSAGE.test(messageOf(err) ?? '')
}

export function isNavigationAbort(err: unknown): boolean {
  if (isAbortLike(err)) return true
  return isLeavingPage() && isFetchFailureLike(err)
}

/** テスト専用: 離脱状態をリセットする（他のテストへ状態を持ち越さないため） */
export function __resetNavigationLeavingStateForTest(): void {
  pageHidden = false
  beforeUnloadAt = null
}

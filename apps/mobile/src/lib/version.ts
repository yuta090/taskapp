/**
 * 「このアプリの版はまだ使えるか」の判定。
 *
 * Web と違い、ストアから入れたアプリは古い版を使い続ける人がいる。DB の形を変えたときに
 * 古い版が壊れた画面を出さないよう、起動時にサーバー（/api/mobile/version）から
 * 対応している最低の版をもらい、それより古ければ更新をお願いする画面に切り替える。
 *
 * 通信に失敗したとき・返事の形がおかしいときは**止めない**（圏外で起動できなくなる方が困る）。
 */

const VERSION_RE = /^\d+(\.\d+)*$/

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function isVersionSupported(current: string | null | undefined, minSupported: string | null): boolean {
  if (!current || !minSupported) return true
  return compareVersions(current, minSupported) >= 0
}

export function parseMinSupportedVersion(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const value = (json as Record<string, unknown>).minSupportedVersion
  return typeof value === 'string' && VERSION_RE.test(value) ? value : null
}

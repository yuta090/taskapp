/**
 * ログイン後・二要素認証後の「戻り先」の検査（純粋・client/server 両用）。
 *
 * 旧: `startsWith('/') && !startsWith('//') && !includes('\\')` だけだったが、
 * `/<TAB>/evil.example` のように制御文字を挟むと new URL() が外部ホストに解決し、フィッシングへ飛ばせた。
 * 制御文字・バックスラッシュ・`//` を弾いたうえで、実際に基準 origin で解決して同一 origin であることを確認する。
 * 検査は必ずここ1か所（複製するとドリフトした瞬間にオープンリダイレクトになる）。
 */
 
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/

export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (!path || typeof path !== 'string') return false
  if (!path.startsWith('/') || path.startsWith('//')) return false
  if (path.includes('\\') || CONTROL_CHARS.test(path)) return false
  try {
    const u = new URL(path, 'https://internal.invalid')
    if (u.origin !== 'https://internal.invalid') return false
    // 解決後のパスが `//` で始まるもの（例: `..` のあとに `//`）は、パス部分だけを
    // 取り出して使われると別ホスト扱いになりうるため、念のため弾く。
    if (u.pathname.startsWith('//')) return false
    return true
  } catch {
    return false
  }
}

/** 安全なら path、そうでなければ fallback（既定 '/'） */
export function safeInternalPathOr(path: string | null | undefined, fallback = '/'): string {
  return isSafeInternalPath(path) ? path : fallback
}

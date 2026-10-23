/**
 * Wiki を重ねて開くときの部品（コード）を先に読み込む。本文（データ）は取らない。
 *
 * 部品は CDN から配られ、1回読めばブラウザに残るので、何度呼んでもサーバーへの通信は増えない。
 * 先に読まないと、初めて開いたときに「本文を取る → エディタ → BlockNote」と順番待ちになり、
 * 本番の実測で約1.1秒かかっていた（2回目以降は約0.12秒）。
 */

/** エディタ（BlockNote を含む、いちばん重い部品） */
export function preloadWikiEditor(): void {
  void import('./WikiEditor')
}

/** 重ねる枠とエディタ。Wiki へのリンクがある詳細を開いたときに、手が空いてから呼ぶ */
export function preloadWikiOverlay(): void {
  void import('./WikiPageOverlay')
  preloadWikiEditor()
}

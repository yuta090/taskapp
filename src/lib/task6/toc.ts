/**
 * 長い記事の目次（TASK6）。
 *
 * 目次は**装飾ではなく機能**として置く。短い記事に付けると、それだけで重い読み物に見えるため、
 * 見出しが一定数を超えたときにだけ出す。階層も h2 だけに絞る（h3 まで並べると、目次自体が
 * 読まなければならないものになる）。
 *
 * 置き場所は**書き出し（最初の `---`）の直後**。冒頭に置くと、エッセイ調の書き出しの余韻を
 * 目次が潰してしまう。解説が始まる位置に置けば、地図として役に立つ。
 */

/** 目次を出す見出しの下限。これ未満の記事には出さない。 */
export const TOC_MIN_HEADINGS = 6

export interface TocHeading {
  id: string
  text: string
}

/**
 * 描画済みHTMLから h2 見出し（id 付き）を本文の順に取り出す。
 * id は rehype-slug が付与する。id が無い見出しはリンクできないので飛ばす。
 */
export function extractH2Headings(html: string): TocHeading[] {
  const headings: TocHeading[] = []
  const re = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const idMatch = /\bid="([^"]+)"/i.exec(m[1])
    if (!idMatch) continue
    // 見出し内の装飾タグ（strong/em など）を落として文字だけにする
    const text = m[2].replace(/<[^>]+>/g, '').trim()
    if (!text) continue
    headings.push({ id: idMatch[1], text })
  }
  return headings
}

/**
 * 最初の `<hr>`（書き出しの終わり）で本文を2つに割る。hr が無ければ全部を rest にする。
 * 呼び出し側は lead → 目次 → rest の順に描画する。
 */
export function splitAfterLead(html: string): { lead: string; rest: string } {
  const m = /<hr\s*\/?>/i.exec(html)
  if (!m) return { lead: '', rest: html }
  const end = m.index + m[0].length
  return { lead: html.slice(0, end), rest: html.slice(end) }
}

/**
 * 同時編集で使う、依存の無い小さな道具だけを置く。
 *
 * **ここに何も import しない**のが約束。書記（`scribe.ts`）と合流の本体（`session.ts`）は
 * この2つだけを使うので、種まき（`seed.ts`）を通さずに済む。種まきは BlockNote と
 * ProseMirror を引き連れてくるため、画面（`MinutesDocumentView`）から辿れる場所に置くと、
 * **会議ページを開いただけでエディタ一式（約120KB）が落ちてくる**（同時編集を使わない
 * 組織でも）。実測で分かった落とし穴。
 */

/** BlockNote の collaboration に渡す Y.XmlFragment の名前。全員で一致している必要がある */
export const MINUTES_FRAGMENT_NAME = 'minutes'

/**
 * 本文から決まる64ビットのハッシュ（16桁の16進）。
 *
 * 暗号用ではなく「同じ本文か違う本文か」を見分けるためのもの。FNV-1a を2本、
 * 別々の素数で回して繋ぐ。`charCodeAt` は UTF-16 の符号単位なので、どのブラウザでも
 * 同じ値になる。
 */
export function minutesSeedHash(markdown: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < markdown.length; i++) {
    const c = markdown.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * 種をまく器の持ち主の番号。0 は使わない（Yjs の既定と紛れないように）。
 *
 * 本文から決めるのが要点で、これで「同じ本文から作った種」は byte 単位で同じになり、
 * Yjs 側が重複として捨てる。**本文のかたまりの持ち主を言い当てるのにも使う** —
 * 違う本文から種が2つ入ったとき、消すほうのかたまりをこの番号で見分ける。
 */
export function seedClientId(seedHash: string): number {
  return (parseInt(seedHash.slice(0, 8), 16) >>> 0) || 1
}

/**
 * 書記 — 同時編集中に、列（`meetings.minutes_md`）へ実際に保存する1つのタブ。
 *
 * 全員が保存すると、更新時刻の楽観ロックで互いを弾き合う（COEDITING_SPEC 4）。
 * そこで保存だけを1人に寄せる。誰が書いても内容は器（Y.Doc）で全員に届くので、
 * 保存する人が1人でも取りこぼしは起きない。
 *
 * 決め方は「いま部屋に居る、輪に入っているタブのうち、いちばん古くから居るタブ」。
 * **人ではなくタブで数える**のが要点。同じ人が2つのタブで開いていたら、その2つは
 * 別々の参加者として扱う（そうしないと互いを相手と見なさず、両方が保存しに行く）。
 * **在席の一覧だけから決まる純粋な計算**にしてあるのが要点で、こうすると各自の時計が
 * ずれていても全員が同じ人を指す。以前は「いまの書記が残っていれば替えない」という
 * 据え置きの規則を置いていたが、「いまの書記」は各自が別々に覚えている値なので、
 * 見え方がずれると2人が同時に自分を書記だと思い込む。だから廃止した。
 *
 * 座席（`joinedAt`）は**チャネルに入るたび**に取り直す。切れて入り直した人は
 * いちばん新しい人になり、書記の座は残っていた人に渡る。
 */
import type * as Y from 'yjs'
import { minutesSeedHash } from './hash'
import { CURSOR_COLOR_COUNT } from './cursorColors'

export interface CollabPeer {
  /**
   * **タブごとの見分け札**（人ごとではない）。
   * 同じ人がタブを2つ並べて開くのは普通の使い方で、人ごとに見分けると自分の
   * 2つのタブが互いを相手と見なさず、どちらも保存しに行って弾き合う。
   */
  id: string
  /**
   * そのタブを開いている人。**見分けには使わない**（見分けは `id`）。
   * 使うのは表示まわりだけ — カーソルの色を人ごとに割り当てるのに要る。
   */
  userId: string
  /** そのタブが部屋に入った時刻（epoch ミリ秒）。各自の時計なので多少のずれは前提 */
  joinedAt: number
  /**
   * そのタブが手前に出ているか。
   * ブラウザは裏に回ったタブの時間の進みを間引き、数分で止める。裏のタブが書記だと
   * **手前で打っているのに保存だけが何分も遅れる**。手前のタブを先に選ぶ。
   */
  visible?: boolean
  /**
   * いま輪に入っているか＝**本文の入った器を持っているか**。
   * 持っていない人を書記にすると、その人の器には他の人の更新が入らないので、
   * **誰の書いた内容も列に残らなくなる**。付け忘れを型で止めるため必須にしてある。
   */
  collab: boolean
  /**
   * いまこの議事録を開いていて、同時編集に加わるつもりか。
   *
   * `collab`（本文を持っている）より**早く立つ**のが要点。ほぼ同時に2人が開いたとき、
   * 「本文を持っている人」だけを見ていると相手に気づけず、どちらも自分で本文を作って
   * しまう。合流すると中身が二重になり、片方を消してももう片方が残る。
   * 居ると分かっていれば、作らずに相手へ聞きに行ける。
   */
  present?: boolean
  /**
   * カーソルの色の番号。まだ決まっていなければ null。
   * 在席に載せて配ることで、**あとから入った人が空いている番号を取れる**ようにする。
   */
  colorIndex?: number | null
  /**
   * 同時編集がタブ単位になる**前の版**の画面か。
   * その相手は人ごとに数えているので、こちらが指した返事役に応えられない。
   * 混ざっている間は、こちらが輪から降りて今までの保存に落とす。
   */
  outdated?: boolean
}

/**
 * 輪に入っているタブだけを並べる。順番は「手前に出ている → 古い → 名札順」。
 * 並べ方は全員で同じなので、誰が計算しても同じ答えになる。
 */
function activeOrdered(peers: CollabPeer[]): CollabPeer[] {
  return peers
    .filter((peer) => peer.collab)
    .sort((a, b) => {
      const aVisible = a.visible !== false
      const bVisible = b.visible !== false
      if (aVisible !== bVisible) return aVisible ? -1 : 1
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt
      return a.id.localeCompare(b.id)
    })
}

/** 書記を決める。いちばん古くから居る人。居なければ null */
export function electScribe(peers: CollabPeer[]): string | null {
  return activeOrdered(peers)[0]?.id ?? null
}

/**
 * 目録合わせ（`y-sync1`）に返事をする人を決める。
 *
 * 全員が返すと、同じ全文が人数ぶん流れる。かといって書記だけにすると、書記が抜けた
 * 瞬間や書記自身が入り直したときに誰も返せない。**尋ねた本人を除いた、いちばん
 * 古い人**にすると、全員が同じ人を指しつつ、書記が尋ねる側でも返事が返る。
 */
export function electAnswerer(peers: CollabPeer[], askerId: string): string | null {
  return activeOrdered(peers).find((peer) => peer.id !== askerId)?.id ?? null
}

/**
 * その人が部屋で何番目に古いか（0 から数える）。人数の上限を当てるのに使う。
 * 並べ方は `electScribe` と同じなので、全員が同じ答えになる。
 */
export function rankOf(peers: CollabPeer[], id: string): number {
  const sorted = activeOrdered(peers)
  const index = sorted.findIndex((peer) => peer.id === id)
  return index === -1 ? sorted.length : index
}

/**
 * その人のカーソルを何番の色で描くか。
 *
 * 部屋の中で**重ならない**ようにするのが目的。人ごとにハッシュで選ぶと、運が悪いと
 * 2人が同じ色になり、どちらが書いているのか分からなくなる。
 *
 * 決め方は「**いま誰も使っていない番号のうち、いちばん小さいもの**」。単純に入った順で
 * 数えると、誰かが抜けたあとに入った人が、残っている人と同じ番号になってしまう
 * （2人の部屋で先に居たほうが抜けると、次に入った人は必ずぶつかる）。
 *
 * 並べ方は**入った順 → 名札順**だけで決める。書記の決め方（`activeOrdered`）とは
 * 分けてあるのが要点で、あちらは「手前に出ているか」で先頭が入れ替わるため、
 * 誰かがタブを切り替えるたびに全員の色がずれてしまう。
 *
 * 同じ人のタブはまとめて1つ（自分の2つのタブは同じ色）。
 * **呼び出し側は、一度決めた番号を会期中は変えないこと**（理由は `cursorColors.ts`）。
 */
export function colorIndexOf(peers: CollabPeer[], userId: string): number {
  // もう名乗っているなら、それを使い続ける
  const mine = peers.find((peer) => peer.userId === userId && typeof peer.colorIndex === 'number')
  if (typeof mine?.colorIndex === 'number') return mine.colorIndex

  const taken = new Set<number>()
  for (const peer of peers) {
    if (peer.userId === userId) continue
    if (typeof peer.colorIndex === 'number') taken.add(peer.colorIndex)
  }
  const free: number[] = []
  for (let i = 0; i < CURSOR_COLOR_COUNT; i++) if (!taken.has(i)) free.push(i)

  // まだ名乗っていない人だけを並べ、自分が何番目かを見る。
  // 同時に入った2人が、同じ空きを取らないようにするため。
  // 輪に入っているかでは絞らない（自分は名乗る前でも数える。絞ると一覧に居らず
  // 0番に落ちて、本物の0番の人とぶつかる）。ただし**自分以外の輪の外の人は数えない**
  // ——数えると7人以上で番号が一周して重なる
  const waiting: string[] = []
  const ordered = [...peers]
    .filter((peer) => peer.collab || peer.userId === userId)
    .sort((a, b) => (a.joinedAt !== b.joinedAt ? a.joinedAt - b.joinedAt : a.id.localeCompare(b.id)))
  for (const peer of ordered) {
    if (typeof peer.colorIndex === 'number') continue
    if (!waiting.includes(peer.userId)) waiting.push(peer.userId)
  }
  const rank = Math.max(0, waiting.indexOf(userId))
  if (free.length === 0) return rank % CURSOR_COLOR_COUNT
  return free[rank % free.length]
}

/** 共有の覚え書きに置く「最後にどこまで保存したか」 */
export interface SavedState {
  /** 保存が通ったときの `updated_at`。次に保存するときの合言葉になる */
  savedAt: string | null
  /** そのとき保存した本文の合言葉。同じなら保存しなくてよい */
  savedHash: string | null
}

const SAVED_AT_KEY = 'savedAt'
const SAVED_HASH_KEY = 'savedHash'

export function readSavedState(meta: Y.Map<unknown>): SavedState {
  const savedAt = meta.get(SAVED_AT_KEY)
  const savedHash = meta.get(SAVED_HASH_KEY)
  return {
    savedAt: typeof savedAt === 'string' ? savedAt : null,
    savedHash: typeof savedHash === 'string' ? savedHash : null,
  }
}

/**
 * 保存が通ったことを全員に伝える。書記が交代したとき、新しい書記はここから
 * 保存の基準を引き継ぐ（自分が開いたときの古い `updated_at` を使わない）。
 */
export function writeSavedState(meta: Y.Map<unknown>, next: SavedState): void {
  meta.doc?.transact(() => {
    if (next.savedAt !== null) meta.set(SAVED_AT_KEY, next.savedAt)
    if (next.savedHash !== null) meta.set(SAVED_HASH_KEY, next.savedHash)
  })
}

/** 本文の合言葉。`savedHash` の計算と、保存が要るかの判定に使う */
export function minutesContentHash(markdown: string): string {
  return minutesSeedHash(markdown)
}

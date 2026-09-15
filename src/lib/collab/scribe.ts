/**
 * 書記 — 同時編集中に、列（`meetings.minutes_md`）へ実際に保存する1人。
 *
 * 全員が保存すると、更新時刻の楽観ロックで互いを弾き合う（COEDITING_SPEC 4）。
 * そこで保存だけを1人に寄せる。誰が書いても内容は器（Y.Doc）で全員に届くので、
 * 保存する人が1人でも取りこぼしは起きない。
 *
 * 決め方は「いま部屋に居る、輪に入っている人のうち、いちばん古くから居る人」。
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

export interface CollabPeer {
  userId: string
  /** その人が部屋に入った時刻（epoch ミリ秒）。各自の時計なので多少のずれは前提 */
  joinedAt: number
  /**
   * いま輪に入っているか。1人で書く形へ落ちた人は false。
   * 落ちた人を書記にすると、その人の器には他の人の更新が入らないので、
   * **誰の書いた内容も列に残らなくなる**。
   */
  collab?: boolean
}

/** 輪に入っている人だけを、古い順に並べる（並べ方は全員で同じ） */
function activeOrdered(peers: CollabPeer[]): CollabPeer[] {
  return peers
    .filter((peer) => peer.collab !== false)
    .sort((a, b) => (a.joinedAt !== b.joinedAt ? a.joinedAt - b.joinedAt : a.userId.localeCompare(b.userId)))
}

/** 書記を決める。いちばん古くから居る人。居なければ null */
export function electScribe(peers: CollabPeer[]): string | null {
  return activeOrdered(peers)[0]?.userId ?? null
}

/**
 * 目録合わせ（`y-sync1`）に返事をする人を決める。
 *
 * 全員が返すと、同じ全文が人数ぶん流れる。かといって書記だけにすると、書記が抜けた
 * 瞬間や書記自身が入り直したときに誰も返せない。**尋ねた本人を除いた、いちばん
 * 古い人**にすると、全員が同じ人を指しつつ、書記が尋ねる側でも返事が返る。
 */
export function electAnswerer(peers: CollabPeer[], askerId: string): string | null {
  return activeOrdered(peers).find((peer) => peer.userId !== askerId)?.userId ?? null
}

/**
 * その人が部屋で何番目に古いか（0 から数える）。人数の上限を当てるのに使う。
 * 並べ方は `electScribe` と同じなので、全員が同じ答えになる。
 */
export function rankOf(peers: CollabPeer[], userId: string): number {
  const sorted = activeOrdered(peers)
  const index = sorted.findIndex((peer) => peer.userId === userId)
  return index === -1 ? sorted.length : index
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

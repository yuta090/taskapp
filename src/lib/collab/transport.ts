/**
 * 同時編集の「運び役」— 更新のかたまりを、同じ議事録を開いている人へ配る道。
 *
 * 本番は Supabase Realtime の broadcast（在席表示と同じ private チャネルに相乗り）。
 * ここでは**形（インターフェース）だけ**を決め、実体は呼び出し側から渡す。理由は2つ。
 *
 * - 合流の本体（`session.ts`）を React も通信も無しでテストできる
 * - いつか常駐サーバー（Hocuspocus 等）へ替えるときに、ここだけ差し替えれば済む
 *   （COEDITING_SPEC 4 の「差し替え口だけ残す」）
 */

/**
 * やり取りする4種類。
 * - `y-sync1`: 「自分はここまで持っている」という目録。入ってきた人が送る
 * - `y-sync2`: その人に足りない分。**書記だけ**が返す（全員が返すと人数倍になる）
 * - `y-update`: 打った文字の差分。300ms ぶんをまとめて送る
 * - `y-aware`: カーソルの位置。1秒に1回まで
 */
export type CollabEvent = 'y-sync1' | 'y-sync2' | 'y-update' | 'y-aware' | 'y-reload'

export type CollabStatus = 'joining' | 'joined' | 'error'

export interface CollabMessage {
  event: CollabEvent
  /** 送り主。`y-sync1` に返事を返すとき、誰に向けてかを決めるのに使う */
  from: string
  /**
   * 宛先。入っていれば、その人以外は捨てる。
   * 配達そのものは部屋全員に届く（broadcast）ので、これは「読む人を絞る」ための札で、
   * 秘密を守るものではない（同じ部屋に入れる人は元々みんな読める）。
   */
  to?: string
  /** byte 列を base64 にしたもの（Realtime は JSON しか運べない） */
  payload: string
}

export interface CollabHandlers {
  onMessage: (message: CollabMessage) => void
  onStatus: (status: CollabStatus) => void
}

export interface CollabTransport {
  join(handlers: CollabHandlers): void
  /** `to` を渡すと、その人だけが読む（ほかの人は捨てる） */
  send(event: CollabEvent, bytes: Uint8Array, to?: string): void
  leave(): void
}

/**
 * byte 列 → base64。
 * 一度に `String.fromCharCode(...bytes)` と展開すると、遅れて入った人へ送る全文
 * （1万3千字で約155KB）でスタックが溢れるので、小分けにして繋ぐ。
 */
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

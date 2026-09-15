/**
 * テスト用の運び役。同じ部屋に入った人へ、その場で（同期的に）配る。
 * 本番の Supabase Realtime の代わりに使い、合流の本体だけを確かめる。
 */
import { bytesToBase64, type CollabEvent, type CollabHandlers, type CollabTransport } from '@/lib/collab/transport'

export interface FakeHub {
  transportFor(userId: string): CollabTransport
  /** いま部屋に居る人 */
  members(): string[]
  /** 送られた通を全部残す（通数の確かめに使う） */
  readonly sent: { from: string; event: CollabEvent; to?: string; payload: string }[]
  /** 次に送ろうとしたら必ず失敗させる */
  breakSending(): void
  /** 回線が切れたことにする（届かない・届けられない） */
  disconnect(userId: string): void
  /** つなぎ直す。入り直しと同じく、つながった知らせをもう一度渡す */
  reconnect(userId: string): void
  /** その人になりすまして1通配る（宛先の確かめに使う） */
  sendAs(from: string, event: CollabEvent, bytes: Uint8Array, to?: string): void
}

export function createFakeHub(): FakeHub {
  const handlers = new Map<string, CollabHandlers>()
  const offline = new Set<string>()
  const sent: { from: string; event: CollabEvent; to?: string; payload: string }[] = []
  let broken = false

  const deliver = (from: string, event: CollabEvent, payload: string, to?: string) => {
    for (const [id, handler] of handlers) {
      if (id === from || offline.has(id)) continue
      handler.onMessage({ event, from, payload, ...(to ? { to } : {}) })
    }
  }

  return {
    sent,
    members: () => Array.from(handlers.keys()),
    breakSending: () => {
      broken = true
    },
    disconnect: (userId) => {
      offline.add(userId)
    },
    reconnect: (userId) => {
      offline.delete(userId)
      handlers.get(userId)?.onStatus('joined')
    },
    sendAs: (from, event, bytes, to) => {
      deliver(from, event, bytes.length === 0 ? '' : bytesToBase64(bytes), to)
    },
    transportFor(userId: string): CollabTransport {
      return {
        join(next: CollabHandlers) {
          handlers.set(userId, next)
          next.onStatus('joined')
        },
        send(event, bytes, to) {
          if (broken) throw new Error('送れません')
          if (offline.has(userId)) return
          const payload = bytes.length === 0 ? '' : bytesToBase64(bytes)
          sent.push({ from: userId, event, payload, ...(to ? { to } : {}) })
          deliver(userId, event, payload, to)
        },
        leave() {
          handlers.delete(userId)
          offline.delete(userId)
        },
      }
    },
  }
}

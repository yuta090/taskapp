/**
 * 同時編集の本体 — 器（Y.Doc）の生涯をみる。
 *
 * やること
 *  1. 部屋の顔ぶれが分かったら、自分ひとりなら列の本文で器を満たし、先客が居れば
 *     「自分はここまで持っている」（`y-sync1`）を配って足りない分をもらう
 *  2. 返事をするのは**尋ねた人を除いたいちばん古い人**1人だけ。全員が返すと人数倍になる
 *  3. 返事は行き帰りの両方: 返す側は足りない分（`y-sync2`）と一緒に自分の目録も送り、
 *     尋ねた側は自分だけが持っている分（`y-update`）を返す。片道だと、切れている間に
 *     入り直した本人が打った分が部屋に届かず、誰にも知らせず消える
 *  4. 打った差分（`y-update`）を 300ms ぶんまとめて配る。カーソル（`y-aware`）は1秒に1回まで
 *  5. 種が2つ入った・更新を取り込めない・1通が大きすぎる等が起きたら、**1人で書く形へ落とす**
 *
 * React も通信も参照しない（運び役 `CollabTransport` は外から渡す）。
 */
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { base64ToBytes, bytesToBase64, type CollabMessage, type CollabTransport } from './transport'
import { MINUTES_FRAGMENT_NAME } from './hash'
import { electAnswerer, type CollabPeer } from './scribe'

/** 打った文字をまとめて送る幅。通信量の見積もりはこの値が前提（COEDITING_SPEC 5.9） */
export const UPDATE_FLUSH_MS = 300
/** カーソルを送る間隔の下限 */
export const AWARENESS_FLUSH_MS = 1_000
/** `y-sync1` の返事を待つ時間。使い切ったら自分で種をまく */
export const SYNC_WAIT_MS = 2_000
/**
 * 1通で送れる大きさ（base64 にしたあとの文字数）。
 * Supabase の上限は1通 3,000KB。その半分に置く。超える通は黙って届かないので、
 * 送る前に測って「断る」か「輪を抜ける」に分ける。
 */
export const MAX_MESSAGE_CHARS = 1_500_000
/** 中身の無い差分の大きさ。これ以下なら送らない（送っても相手に足されるものが無い） */
const EMPTY_UPDATE_BYTES = 2

/** 1人で書く形へ落とす理由 */
export type DegradeReason =
  | 'transport-error'
  | 'duplicate-seed'
  | 'apply-failed'
  | 'too-many-peers'
  | 'too-large'

export interface MinutesSessionOptions {
  /** 自分の user id。返事を返す人かどうかの判定に使う */
  selfId: string
  transport: CollabTransport
  /** 1人で書く形へ落とすときに呼ぶ。以後このセッションは何も送らない */
  onDegrade: (reason: DegradeReason) => void
  /**
   * 本文が器に入った（種をまいた・相手から受け取った）ときに1回だけ呼ぶ。
   * それまでエディタは空なので、呼び出し側はここまで書けないようにする
   * （空の器に書くと、あとから届いた本文と混ざる）。
   */
  onSynced?: () => void
  /**
   * 部屋の誰かが「列を読み直してほしい」と言ってきたとき（タスク化のあと）。
   * タスク化は DB 側で本文を書き換える（行末に目印を足す）ので、器の中身と
   * 列の中身がずれる。そのまま書き続けると、次の保存が必ず弾かれる。
   */
  onRoomReload?: () => void
}

/**
 * 器に種をまく係。pmSchema を閉じ込めるのは呼び出し側（エディタを持っている側）。
 * まいた本文の合言葉（seedHash）を返す。
 */
export type MinutesSeeder = (doc: Y.Doc) => string

export class MinutesCollabSession {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly fragment: Y.XmlFragment
  /** 保存の基準など、全員で共有する小さな覚え書き */
  readonly meta: Y.Map<unknown>
  /** まかれた種の合言葉。2つ以上になったら本文が二重になっている */
  private readonly seeds: Y.Map<unknown>

  private readonly options: MinutesSessionOptions
  /** 種をまく係。エディタが載ってから入る（それまでは合流を始めない） */
  private seeder: MinutesSeeder | null = null
  /** いま部屋に居る人（自分を含む）。返事を返す人を決めるのに使う */
  private peers: CollabPeer[] = []
  private pendingUpdates: Uint8Array[] = []
  private updateTimer: ReturnType<typeof setTimeout> | null = null
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null
  private awarenessDirty = false
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private syncAttempts = 0
  private synced = false
  private started = false
  private degraded = false
  private disposed = false
  private applyingRemote = false

  constructor(options: MinutesSessionOptions) {
    this.options = options
    this.doc = new Y.Doc()
    this.fragment = this.doc.getXmlFragment(MINUTES_FRAGMENT_NAME)
    this.meta = this.doc.getMap('meta')
    this.seeds = this.doc.getMap('seeds')
    this.awareness = new Awareness(this.doc)
  }

  /** いま縮退しているか（落ちたら以後は何も送らない） */
  get isDegraded(): boolean {
    return this.degraded
  }

  /** 本文が器に入ったか（まだなら種まきの猶予中） */
  get isSynced(): boolean {
    return this.synced
  }

  /**
   * いま相手の更新を取り込んでいる最中か。
   *
   * 取り込みはエディタの変更としても届くので、そのままだと「自分が書いた」ときと
   * 見分けがつかない。チェックを入れたらタスクを完了にする処理などが、相手の画面でも
   * 一斉に走ってしまう。取り込みは同期的に終わるので、この間だけ印を立てて見分ける。
   */
  get isApplyingRemote(): boolean {
    return this.applyingRemote
  }

  /** 種をまく係を入れ替える。エディタが載ったときに呼ぶ */
  setSeeder(seeder: MinutesSeeder | null): void {
    this.seeder = seeder
  }

  /** 部屋の顔ぶれを入れ替える。在席が変わるたびに呼ぶ */
  setPeers(peers: CollabPeer[]): void {
    this.peers = peers
  }

  start(): void {
    if (this.started || this.disposed) return
    if (!this.seeder) return
    this.started = true

    this.doc.on('update', this.handleLocalUpdate)
    this.awareness.on('update', this.handleAwarenessChange)
    this.seeds.observe(this.handleSeedsChange)

    this.options.transport.join({
      onMessage: this.handleMessage,
      onStatus: (status) => {
        if (status === 'error') {
          this.degrade('transport-error')
          return
        }
        if (status === 'joined') this.handleJoined()
      },
    })
  }

  destroy(): void {
    if (this.disposed) return

    // 閉じる前に2つ配る。印（disposed）を立てたあとでは送れないので順番が要る。
    //  1. 溜めていた差分。ここで流さないと、離れる直前の最大300ms ぶんが相手に届かない
    //  2. 自分のカーソルを消す知らせ。配らないと、相手の画面に最大30秒とどまる
    if (this.started && !this.degraded) {
      if (this.updateTimer) {
        clearTimeout(this.updateTimer)
        this.updateTimer = null
      }
      this.flushUpdates()
      try {
        removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
        this.send('y-aware', encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
      } catch {
        // 片付けの失敗で画面を壊さない
      }
    }

    this.disposed = true
    this.clearTimers()
    this.doc.off('update', this.handleLocalUpdate)
    this.awareness.off('update', this.handleAwarenessChange)
    this.seeds.unobserve(this.handleSeedsChange)
    this.awareness.destroy()
    this.options.transport.leave()
    this.doc.destroy()
  }

  /** 部屋のみんなに「列を読み直して」と伝える（タスク化のあと） */
  requestRoomReload(): void {
    this.send('y-reload', new Uint8Array(0))
  }

  // ── 入ったとき ──────────────────────────────────────────

  /**
   * 部屋の顔ぶれが分かった時点で呼ばれる（チャネルに入った直後ではない。
   * 入った直後は在席の一覧がまだ届いておらず、必ず「自分ひとり」に見えるため）。
   */
  private handleJoined(): void {
    if (this.disposed || this.degraded) return
    const others = this.peers.filter((peer) => peer.userId !== this.options.selfId && peer.collab)
    // 自分ひとりなら誰の返事も待たずに列の本文で満たす。先客が居れば必ず握手する
    // （既に本文を持っていても、切れている間に増えた分をもらうため）
    if (others.length === 0) {
      this.seedNow()
      return
    }
    this.syncAttempts = 0
    this.sendSync1()
  }

  private sendSync1(to?: string): void {
    if (this.disposed || this.degraded) return
    this.syncAttempts += 1
    this.send('y-sync1', Y.encodeStateVector(this.doc), to)
    if (to) return // 返事の中で送る目録には、待ち時間を張らない
    this.clearSyncTimer()
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      if (this.synced || this.disposed || this.degraded) return
      // 1回だけ送り直し、それでも返事が無ければ自分で種をまく
      if (this.syncAttempts < 2) {
        this.sendSync1()
        return
      }
      this.seedNow()
    }, SYNC_WAIT_MS)
  }

  /** 列の本文から種をまく。まいた合言葉を共有の覚え書きに残す */
  private seedNow(): void {
    if (this.disposed || this.degraded || this.synced) return
    try {
      const seeder = this.seeder
      if (!seeder) return
      const seedHash = seeder(this.doc)
      this.doc.transact(() => {
        this.seeds.set(seedHash, 1)
      })
      this.markSynced()
    } catch {
      this.degrade('apply-failed')
    }
  }

  // ── 受け取り ────────────────────────────────────────────

  private handleMessage = (message: CollabMessage): void => {
    if (this.disposed || this.degraded) return
    if (message.from === this.options.selfId) return
    // 宛先が付いていて自分宛でなければ読まない
    if (message.to && message.to !== this.options.selfId) return

    try {
      if (message.event === 'y-reload') {
        this.options.onRoomReload?.()
        return
      }

      if (message.event === 'y-sync1') {
        // 本文を持っていない人は返さない（空の器を配ると、受け取った側が
        // 「本文が入った」と勘違いして空のまま打ち始める）
        if (!this.synced) return
        const askerVector = base64ToBytes(message.payload)

        if (message.to === this.options.selfId) {
          // 返事の中で届いた目録（行き帰りの「帰り」）。自分だけが持っている分を返す。
          // ここで**さらに返事をしない**のが要点で、返すと永久に往復し続ける
          const diff = Y.encodeStateAsUpdate(this.doc, askerVector)
          if (diff.length > EMPTY_UPDATE_BYTES) this.send('y-update', diff, message.from)
          return
        }

        // 返すのは「尋ねた人を除いたいちばん古い人」1人だけ
        if (electAnswerer(this.peers, message.from) !== this.options.selfId) return
        this.send('y-sync2', Y.encodeStateAsUpdate(this.doc, askerVector), message.from)
        // 行き帰りの「行き」: 相手だけが持っている分をもらうため、自分の目録も送る。
        // これが無いと、切れている間に相手が打った分が部屋に届かず静かに消える
        this.sendSync1(message.from)
        return
      }

      if (message.event === 'y-aware') {
        applyAwarenessUpdate(this.awareness, base64ToBytes(message.payload), 'remote')
        return
      }

      // y-sync2 / y-update
      if (message.event === 'y-sync2' && message.payload === '') {
        // 「大きすぎて送れない」という断りの合図。まだ本文が無いなら輪を抜ける
        if (!this.synced) this.degrade('too-large')
        return
      }
      const bytes = base64ToBytes(message.payload)
      this.applyingRemote = true
      try {
        Y.applyUpdate(this.doc, bytes, 'remote')
      } finally {
        this.applyingRemote = false
      }
      this.markSynced()
    } catch {
      // 壊れた更新は捨てる（1通で画面全体を止めない）。ただし取り込みに失敗した
      // 状態で書き続けると本文がずれるので、種の重複と同じく縮退させる
      this.degrade('apply-failed')
    }
  }

  /**
   * 本文が入ったことを1回だけ知らせる。
   * **空の器では知らせない** — まだ本文を持っていない人が返した空の差分で
   * 「入った」ことにすると、空のまま打てるようになり、あとから届いた本文と混ざる。
   */
  private markSynced(): void {
    if (this.synced) return
    if (this.fragment.length === 0) return
    this.synced = true
    this.clearSyncTimer()
    this.options.onSynced?.()
  }

  private handleSeedsChange = (): void => {
    if (this.seeds.size > 1) this.degrade('duplicate-seed')
  }

  // ── 送り出し ────────────────────────────────────────────

  private handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    // 受け取った更新をそのまま送り返さない（往復し続ける）
    if (origin === 'remote' || this.disposed || this.degraded) return
    this.pendingUpdates.push(update)
    if (this.updateTimer) return
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null
      this.flushUpdates()
    }, UPDATE_FLUSH_MS)
  }

  private flushUpdates(): void {
    if (this.disposed || this.degraded) return
    const batch = this.pendingUpdates
    this.pendingUpdates = []
    if (batch.length === 0) return
    this.send('y-update', batch.length === 1 ? batch[0] : Y.mergeUpdates(batch))
  }

  private handleAwarenessChange = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === 'remote' || this.disposed || this.degraded) return
    this.awarenessDirty = true
    if (this.awarenessTimer) return
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null
      if (!this.awarenessDirty) return
      this.awarenessDirty = false
      this.send('y-aware', encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
    }, AWARENESS_FLUSH_MS)
    void changes
  }

  private send(event: CollabMessage['event'], bytes: Uint8Array, to?: string): void {
    if (this.disposed || this.degraded) return
    try {
      const payload = bytes.length === 0 ? '' : bytesToBase64(bytes)
      if (payload.length > MAX_MESSAGE_CHARS) {
        // 大きすぎる通は黙って届かない。相手が待ちぼうけて自分で種をまくと本文が
        // 二重になるので、行き先によって分ける
        if (event === 'y-sync2') {
          // 空で返して「送れない」と伝える。相手は輪に入らず1人で書く形になる
          this.options.transport.send('y-sync2', new Uint8Array(0), to)
          return
        }
        // 自分が打った分が誰にも届かない。黙って消えるより、自分で保存する側に回る
        this.degrade('too-large')
        return
      }
      this.options.transport.send(event, bytes, to)
    } catch {
      this.degrade('transport-error')
    }
  }

  // ── 縮退 ────────────────────────────────────────────────

  /** 外から気づいた事情（人数が多い・本文が大きすぎる）でも落とせるようにする */
  degrade(reason: DegradeReason): void {
    if (this.degraded) return
    this.degraded = true
    this.clearTimers()
    this.options.onDegrade(reason)
  }

  private clearSyncTimer(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
  }

  private clearTimers(): void {
    this.clearSyncTimer()
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    if (this.awarenessTimer) {
      clearTimeout(this.awarenessTimer)
      this.awarenessTimer = null
    }
  }
}

/** base64 を外にも出す（運び役の実体が使う） */
export { bytesToBase64, base64ToBytes }

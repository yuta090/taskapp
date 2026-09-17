// @vitest-environment jsdom
/**
 * 同時編集の本体（`MinutesCollabSession`）を、テスト用の運び役で数人ぶん動かして確かめる。
 * 本物の通信もエディタも使わず、合流のしかたそのものを見る。
 *
 * 守りたい要点:
 *  - 部屋に先客が居るのに自分の本文で器を作り直さない（本文が二重になる）
 *  - 返事を返すのは1人だけ（全員が返すと同じ全文が人数ぶん流れる）
 *  - 返事は行き帰り（切れている間に自分が打った分も部屋へ届く）
 *  - 空の器で「本文が入った」ことにしない（空のまま打つと混ざる）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  MinutesCollabSession,
  MAX_MESSAGE_CHARS,
  SYNC_WAIT_MS,
  UPDATE_FLUSH_MS,
  AWARENESS_FLUSH_MS,
} from '@/lib/collab/session'
import type { DegradeReason } from '@/lib/collab/session'
import { minutesSeedHash, seedClientId } from '@/lib/collab/hash'
import { readSavedState } from '@/lib/collab/scribe'
import { createFakeHub } from './fakeTransport'
import { applyMarkdown, blockGroupCount, readBackMarkdown, seedWith } from './minutesTestSchema'

const BASE = ['# 会議', '', '- 決めたこと'].join('\n')

interface Member {
  session: MinutesCollabSession
  degraded: DegradeReason[]
  reloads: number
}

/**
 * 部屋の顔ぶれ。`id` は**タブごと**の見分け札（人ごとではない）。
 * `joinedAt` が小さいほど古株。`collab` は本文の入った器を持っているか。
 */
type Room = { id: string; userId?: string; joinedAt: number; collab?: boolean; present?: boolean }[]

const members: Member[] = []

/**
 * 部屋に入る。実際の画面では在席の一覧から顔ぶれを組み立てるが、ここでは直接渡す。
 * 既に居る人にも同じ顔ぶれを伝える（在席は全員に配られるため）。
 */
function join(
  hub: ReturnType<typeof createFakeHub>,
  tabId: string,
  room: Room,
  markdown = BASE,
  basis: string | null = null
): Member {
  const degraded: DegradeReason[] = []
  const member: Member = {
    degraded,
    reloads: 0,
    session: new MinutesCollabSession({
      selfId: tabId,
      transport: hub.transportFor(tabId),
      onDegrade: (reason) => degraded.push(reason),
      onRoomReload: () => {
        member.reloads += 1
      },
    }),
  }
  member.session.setSeeder(seedWith(markdown, basis))
  members.push(member)
  // 在席は全員に配られる。入る前から居た人にも新しい顔ぶれが届く。
  // ここでは「居る人はみな器を持っている」ことにする（持っていない人の扱いは
  // scribe.test.ts で見ている）
  const announced = room.map((peer) => ({ collab: true, userId: peer.id, ...peer }))
  for (const existing of members) existing.session.setPeers(announced)
  member.session.start()
  return member
}

beforeEach(() => {
  vi.useFakeTimers()
  members.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

describe('部屋に入ったとき', () => {
  it('自分しか居なければ、列の本文で器を満たす', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
    expect(tanaka.session.isSynced).toBe(true)
  })

  it('先客が居れば、その人から本文を受け取って同じ内容になる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ])

    expect(yamada.session.isSynced).toBe(true)
    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
  })

  it('先客が居るときは、自分の本文で器を作り直さない', () => {
    // 田中が開いたあとに外から1行足された、という場面。山田の列は新しいが、
    // 部屋の器（田中が作ったもの）に合わせる。作り直すと本文が二重になる
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(
      hub,
      'yamada',
      [
        { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
        { id: 'yamada', userId: 'yamada', joinedAt: 200 },
      ],
      `${BASE}\n- あとから足された行`
    )

    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
    expect(yamada.degraded).toEqual([])
    expect(tanaka.degraded).toEqual([])
  })

  it('返事を返すのは、尋ねた人を除いたいちばん古い1人だけ', () => {
    const hub = createFakeHub()
    const room2: Room = [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ]
    join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    join(hub, 'yamada', room2)
    hub.sent.length = 0

    join(hub, 'suzuki', [...room2, { id: 'suzuki', userId: 'suzuki', joinedAt: 300 }])

    const answers = hub.sent.filter((s) => s.event === 'y-sync2')
    expect(answers).toHaveLength(1)
    expect(answers[0].from).toBe('tanaka')
  })

  it('誰も返事をくれなければ、2回試してから自分で種をまく', () => {
    const hub = createFakeHub()
    // 部屋には先客が居ることになっているが、実際には返事が返らない
    const yamada = join(hub, 'yamada', [
      { id: 'ghost', userId: 'ghost', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ])

    expect(yamada.session.isSynced).toBe(false)
    vi.advanceTimersByTime(SYNC_WAIT_MS)
    expect(yamada.session.isSynced).toBe(false)
    vi.advanceTimersByTime(SYNC_WAIT_MS)

    expect(yamada.session.isSynced).toBe(true)
    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
    expect(hub.sent.filter((s) => s.event === 'y-sync1' && !s.to)).toHaveLength(2)
  })

  it('先客が本文をまだ持っていなくても、自分で本文を作らずに待つ', () => {
    // 2人がほぼ同時に開いたときの再現。先に開いた人が本文を持って保存したあとに
    // 2人目が開くと、「本文を持っている人」だけを見ていては相手に気づけず、
    // 自分で作ってしまう。作った本文と相手の本文が合流すると**中身が二重になり**、
    // 片方を消してももう片方が残る（＝書いた文字が消えない）
    const hub = createFakeHub()
    const yamada = join(hub, 'tab-yamada', [
      // 田中は開いているが、まだ本文を受け取っていない（collab: false）
      { id: 'tab-tanaka', userId: 'u-tanaka', joinedAt: 100, collab: false, present: true },
      { id: 'tab-yamada', userId: 'u-yamada', joinedAt: 200, collab: false, present: true },
    ])

    // 自分で作らず、目録合わせを送って待つ
    expect(yamada.session.isSynced).toBe(false)
    expect(readBackMarkdown(yamada.session.doc)).toBe('')
    expect(hub.sent.filter((s) => s.event === 'y-sync1')).toHaveLength(1)
  })

  it('誰も本文を持っていなければ、いちばん古い1人だけが作る', () => {
    // 2人がほぼ同時に開いた場面。どちらも本文をまだ持っていないので、
    // 互いに尋ねても誰も答えられない。猶予切れまで待つと**両方が作って二重になる**ので、
    // 顔ぶれから種まき係を1人決め、その人だけが待たずに作る
    const hub = createFakeHub()
    const room: Room = [
      { id: 'tab-tanaka', userId: 'u-tanaka', joinedAt: 100, collab: false, present: true },
      { id: 'tab-yamada', userId: 'u-yamada', joinedAt: 200, collab: false, present: true },
    ]
    const tanaka = join(hub, 'tab-tanaka', room)
    const yamada = join(hub, 'tab-yamada', room)

    // 古いほうは待たずに作る
    expect(tanaka.session.isSynced).toBe(true)
    // 新しいほうは作らず、配られた本文を受け取る
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)
    expect(yamada.session.isSynced).toBe(true)
    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
    expect(blockGroupCount(yamada.session.doc)).toBe(1)
    expect([...tanaka.degraded, ...yamada.degraded]).toEqual([])
  })

  it('本文を持った直後、在席の一覧がまだ古くても返事をする', () => {
    // 在席が配り直されるまでの間、自分は一覧の上では「持っていない」ままになる。
    // 一覧をそのまま信じると、持っているのに返事役から外れて相手が待ちぼうけになる
    const hub = createFakeHub()
    const alone: Room = [{ id: 'tab-tanaka', userId: 'u-tanaka', joinedAt: 100, collab: false, present: true }]
    const tanaka = join(hub, 'tab-tanaka', alone)
    expect(tanaka.session.isSynced).toBe(true)
    hub.sent.length = 0

    const yamada = join(hub, 'tab-yamada', [
      ...alone,
      { id: 'tab-yamada', userId: 'u-yamada', joinedAt: 200, collab: false, present: true },
    ])

    expect(hub.sent.filter((s) => s.event === 'y-sync2' && s.from === 'tab-tanaka')).toHaveLength(1)
    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
  })

  it('誰も開いていなければ、これまでどおり自分で本文を作る', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tab-tanaka', [
      { id: 'tab-tanaka', userId: 'u-tanaka', joinedAt: 100, collab: false, present: true },
    ])
    expect(tanaka.session.isSynced).toBe(true)
    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
  })

  it('本文を持っていない人は返事をしない（空の器を配らない）', () => {
    const hub = createFakeHub()
    const room: Room = [
      { id: 'a', userId: 'a', joinedAt: 100 },
      { id: 'b', userId: 'b', joinedAt: 200 },
    ]
    // a も b も先客が居ることになっていて、どちらも本文を持っていない
    const a = join(hub, 'a', [{ id: 'ghost', userId: 'ghost', joinedAt: 50 }, ...room])
    hub.sent.length = 0
    join(hub, 'b', [{ id: 'ghost', userId: 'ghost', joinedAt: 50 }, ...room])

    expect(hub.sent.filter((s) => s.event === 'y-sync2')).toHaveLength(0)
    expect(a.session.isSynced).toBe(false)
  })
})

describe('切れて入り直したとき', () => {
  it('既に本文を持っていれば、種は作らず握手をやり直す', () => {
    // 作らずに黙って帰ると、留守の間に部屋で増えた分をもらい損ねる
    const hub = createFakeHub()
    const a = join(hub, 'tab-a', [{ id: 'tab-a', userId: 'u-a', joinedAt: 100, collab: false, present: true }])
    expect(a.session.isSynced).toBe(true)
    // 在席の上ではまだ誰も本文を持っておらず、自分がいちばん古い
    a.session.setPeers([
      { id: 'tab-a', userId: 'u-a', joinedAt: 100, collab: false, present: true },
      { id: 'tab-b', userId: 'u-b', joinedAt: 200, collab: false, present: true },
    ])
    hub.sent.length = 0

    hub.disconnect('tab-a')
    hub.reconnect('tab-a')

    expect(hub.sent.filter((s) => s.from === 'tab-a' && s.event === 'y-sync1')).toHaveLength(1)
  })

  it('入り直した人が切れている間に打った分も、部屋へ届く', () => {
    const hub = createFakeHub()
    const room: Room = [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ]
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    // 山田が切れる（運び役から外れる）。その間に双方が別の場所を打つ
    yamada.session.setPeers(room.map((peer) => ({ collab: true, userId: peer.id, ...peer })))
    hub.disconnect('yamada')
    applyMarkdown(yamada.session.doc, `${BASE}\n- 山田が切れている間に書いた`)
    applyMarkdown(tanaka.session.doc, `# 会議（田中が直した）\n\n- 決めたこと`)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    // 入り直す（座席は新しくなるので、書記は田中のまま）
    hub.reconnect('yamada')
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    const a = readBackMarkdown(tanaka.session.doc)
    const b = readBackMarkdown(yamada.session.doc)
    expect(a).toBe(b)
    expect(a).toContain('山田が切れている間に書いた')
    expect(a).toContain('田中が直した')
  })
})

describe('打った内容の配り方', () => {
  const room: Room = [
    { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
    { id: 'yamada', userId: 'yamada', joinedAt: 200 },
  ]

  it('まとめて相手へ届く', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    const typed = `${BASE}\n- 山田が足した行`
    applyMarkdown(yamada.session.doc, typed)

    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)
    expect(readBackMarkdown(tanaka.session.doc)).toBe(typed)
  })

  it('打ち続けても、まとめる幅ごとに1通だけ送る', () => {
    const hub = createFakeHub()
    join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)
    hub.sent.length = 0

    for (let i = 1; i <= 5; i++) {
      applyMarkdown(yamada.session.doc, `${BASE}\n- ${i}行目`)
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    expect(hub.sent.filter((s) => s.from === 'yamada' && s.event === 'y-update')).toHaveLength(1)
  })

  it('二人が別の場所を同時に打っても、どちらの内容も残って同じになる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    applyMarkdown(tanaka.session.doc, `# 会議（田中が直した）\n\n- 決めたこと`)
    applyMarkdown(yamada.session.doc, `${BASE}\n- 山田が足した行`)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    const a = readBackMarkdown(tanaka.session.doc)
    expect(a).toBe(readBackMarkdown(yamada.session.doc))
    expect(a).toContain('田中が直した')
    expect(a).toContain('山田が足した行')
  })

  it('受け取った内容を、そのまま送り返さない', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    applyMarkdown(yamada.session.doc, `${BASE}\n- 山田`)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)
    hub.sent.length = 0
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 5)

    expect(hub.sent.filter((s) => s.from === 'tanaka' && s.event === 'y-update')).toHaveLength(0)
    expect(tanaka.session.isDegraded).toBe(false)
  })

  it('離れる直前にためていた分も配る', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    applyMarkdown(yamada.session.doc, `${BASE}\n- 閉じる直前に書いた`)
    // まとめる幅を待たずに閉じる
    yamada.session.destroy()

    expect(readBackMarkdown(tanaka.session.doc)).toContain('閉じる直前に書いた')
  })
})

describe('カーソル', () => {
  const room: Room = [
    { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
    { id: 'yamada', userId: 'yamada', joinedAt: 200 },
  ]

  it('1秒に1回までしか送らない', () => {
    const hub = createFakeHub()
    join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)
    hub.sent.length = 0

    for (let i = 0; i < 10; i++) {
      yamada.session.awareness.setLocalStateField('cursor', { anchor: i })
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(AWARENESS_FLUSH_MS)

    expect(hub.sent.filter((s) => s.event === 'y-aware')).toHaveLength(1)
  })

  it('相手のカーソルが届く', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    yamada.session.awareness.setLocalStateField('user', { name: '山田' })
    vi.advanceTimersByTime(AWARENESS_FLUSH_MS)

    const seen = Array.from(tanaka.session.awareness.getStates().values())
      .map((state) => (state as { user?: { name?: string } }).user?.name)
      .filter(Boolean)
    expect(seen).toContain('山田')
  })

  it('離れたら、自分のカーソルを消す知らせを配る', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)
    yamada.session.awareness.setLocalStateField('user', { name: '山田' })
    vi.advanceTimersByTime(AWARENESS_FLUSH_MS)

    yamada.session.destroy()

    const seen = Array.from(tanaka.session.awareness.getStates().values())
      .map((state) => (state as { user?: { name?: string } } | null)?.user?.name)
      .filter(Boolean)
    expect(seen).not.toContain('山田')
  })
})

describe('1人で書く形へ落とすとき', () => {
  const room: Room = [
    { id: 'a', userId: 'a', joinedAt: 100 },
    { id: 'b', userId: 'b', joinedAt: 200 },
  ]

  it('同じ本文なら、2人同時にまいても二重にならない', () => {
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ id: 'ghost', userId: 'ghost', joinedAt: 50 }, ...room])
    const b = join(hub, 'b', [{ id: 'ghost', userId: 'ghost', joinedAt: 50 }, ...room])
    vi.advanceTimersByTime(SYNC_WAIT_MS * 2)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    expect(readBackMarkdown(a.session.doc)).toBe(BASE)
    expect(readBackMarkdown(b.session.doc)).toBe(BASE)
    expect(a.degraded).toEqual([])
  })

  it('つながらなければ落とす', () => {
    const degraded: DegradeReason[] = []
    const session = new MinutesCollabSession({
      selfId: 'tanaka',
      transport: {
        join: (handlers) => handlers.onStatus('error'),
        send: () => {},
        leave: () => {},
      },
      onDegrade: (reason) => degraded.push(reason),
    })
    session.setSeeder(seedWith(BASE))
    session.setPeers([{ id: 'tanaka', userId: 'tanaka', joinedAt: 100, collab: true }])
    session.start()

    expect(degraded).toEqual(['transport-error'])
    expect(session.isDegraded).toBe(true)
  })

  it('送れなくなったら落とし、以後は送らない', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    hub.breakSending()

    applyMarkdown(tanaka.session.doc, `${BASE}\n- 田中`)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    expect(tanaka.degraded).toEqual(['transport-error'])
    hub.sent.length = 0
    applyMarkdown(tanaka.session.doc, `${BASE}\n- もう1行`)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 3)
    expect(hub.sent).toHaveLength(0)
  })
})

describe('本文が二重になったとき', () => {
  /** 返事をしない先客。これが居ると全員が猶予切れまで待ち、そのあと各自がまく */
  const ghost: Room = [{ id: 'ghost', userId: 'ghost', joinedAt: 50 }]
  const room: Room = [
    { id: 'a', userId: 'a', joinedAt: 100 },
    { id: 'b', userId: 'b', joinedAt: 200 },
  ]
  const OLDER = '2026-09-17T10:00:00+09:00'
  const NEWER = '2026-09-17T10:05:00+09:00'
  const EXTRA = `${BASE}\n- あとから足された行`

  /** 違う本文から2人が同時にまいた状態を作る */
  function collide() {
    const hub = createFakeHub()
    const a = join(hub, 'a', [...ghost, ...room], BASE, OLDER)
    const b = join(hub, 'b', [...ghost, ...room], EXTRA, NEWER)
    vi.advanceTimersByTime(SYNC_WAIT_MS * 2)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)
    return { a, b }
  }

  it('新しいほうに揃えて、1つに戻す', () => {
    // 選び方を工夫しても、在席が行き渡るより短い間に2人が開けば衝突は残る。
    // 起きないようにするのではなく、起きても全員が同じ規則で1つに戻す
    const { a, b } = collide()

    expect(readBackMarkdown(a.session.doc)).toBe(EXTRA)
    expect(readBackMarkdown(b.session.doc)).toBe(EXTRA)
    expect(blockGroupCount(a.session.doc)).toBe(1)
    expect(blockGroupCount(b.session.doc)).toBe(1)
    expect([...a.degraded, ...b.degraded]).toEqual([])
  })

  it('保存の基準も、残したほうに合わせる', () => {
    // 合わせないと、負けた本文を読んでいた書記が古い基準で保存しに行き、
    // 「ほかの人が先に書き換えました」の帯が出続ける
    const { a, b } = collide()

    expect(readSavedState(a.session.meta).savedAt).toBe(NEWER)
    expect(readSavedState(b.session.meta).savedAt).toBe(NEWER)
  })

  it('1つ前の版が入れた印は、いちばん古い扱いにする', () => {
    // 旧版は基準を持たない印（1）を入れる。読めない印を新しい側に倒すと、
    // 古い本文が残って新しい本文が消える
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ id: 'a', userId: 'a', joinedAt: 100 }], BASE, OLDER)
    const legacy = new Y.Doc()
    const { seedHash } = seedWith(EXTRA)(legacy)
    legacy.getMap('seeds').set(seedHash, 1)
    hub.sendAs('old-tab', 'y-update', Y.encodeStateAsUpdate(legacy))

    expect(readBackMarkdown(a.session.doc)).toBe(BASE)
    expect(blockGroupCount(a.session.doc)).toBe(1)
    expect(a.degraded).toEqual([])
  })

  it('残すはずの本文を自分が持っていないときは、何も消さない', () => {
    // いちばん危ない道すじ。相手の本文の通を1通取りこぼした人が「消す」判断だけ
    // すると、自分の本文が消えて**中身がゼロ**になる。議事録には版の控えが無く、
    // そのまま1行打つと空の本文で列を上書きしてしまう
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ id: 'a', userId: 'a', joinedAt: 100 }], BASE, OLDER)
    // 種の印だけが届き、本文そのものは届かなかった状態
    const announce = new Y.Doc()
    announce.getMap('seeds').set(minutesSeedHash(EXTRA), NEWER)
    hub.sendAs('b', 'y-update', Y.encodeStateAsUpdate(announce))

    expect(blockGroupCount(a.session.doc)).toBe(1)
    expect(readBackMarkdown(a.session.doc)).toBe(BASE)
    // 消せないので、これまでどおり列から読み直す形へ落ちる
    expect(a.degraded).toContain('duplicate-seed')
  })

  it('相手が直した結果だけが届いても、本文を空にしない', () => {
    // いちばん危ない道すじ。相手の本文をまだ受け取っていない人に「消す」通だけが
    // 届くと、手元のかたまりが消えて**中身がゼロ**になる。自分の種の一覧は1つの
    // ままなので直しの処理も走らず、白紙のまま書けてしまう
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ id: 'a', userId: 'a', joinedAt: 100 }], EXTRA, OLDER)
    expect(blockGroupCount(a.session.doc)).toBe(1)

    // 相手の器では、両方の種が揃っていて、新しいほうが勝っている
    const peer = new Y.Doc()
    const mine = seedWith(EXTRA, OLDER)(peer)
    const theirs = seedWith(BASE, NEWER)(peer)
    peer.getMap('seeds').set(mine.seedHash, OLDER)
    peer.getMap('seeds').set(theirs.seedHash, NEWER)
    const beforeRepair = Y.encodeStateVector(peer)
    // 相手が直して、負けた（＝こちらが持っている）かたまりを消す
    const peerFragment = peer.getXmlFragment('minutes')
    peer.transact(() => {
      for (let i = peerFragment.length - 1; i >= 0; i--) {
        const child = peerFragment.get(i) as { _item?: { id?: { client?: number } } }
        if (child._item?.id?.client === seedClientId(mine.seedHash)) peerFragment.delete(i, 1)
      }
    })
    // 配られるのは「消した」という差分だけ。相手の本文は届かない
    hub.sendAs('b', 'y-update', Y.encodeStateAsUpdate(peer, beforeRepair))

    // 空のまま書かせない。列から読み直す形へ落ちる
    expect(a.degraded).toContain('duplicate-seed')
  })

  it('どちらが新しいか分からないときは、勝手に選ばない', () => {
    // 基準が読めない種どうし。判断材料が無いのに片方を消すと、消えた側は戻せない
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ id: 'a', userId: 'a', joinedAt: 100 }], BASE, null)
    const other = new Y.Doc()
    const { seedHash } = seedWith(EXTRA)(other)
    other.getMap('seeds').set(seedHash, '')
    hub.sendAs('b', 'y-update', Y.encodeStateAsUpdate(other))

    // どちらも消さずに残し、列から読み直す形へ落ちる
    expect(a.degraded).toContain('duplicate-seed')
    expect(blockGroupCount(a.session.doc)).toBe(2)
  })

  it('本文のかたまりの持ち主は、種の合言葉から決まる番号で分かる', () => {
    // Yjs の中の作りに頼っているので、上げたときに気づけるよう固定しておく。
    // 読めなくなると、直しが静かに空振りして毎回読み直しに落ちる
    const doc = new Y.Doc()
    const { seedHash } = seedWith(BASE)(doc)
    const first = doc.getXmlFragment('minutes').get(0) as { _item?: { id?: { client?: number } } }
    expect(first._item?.id?.client).toBe(seedClientId(seedHash))
  })

  it('直しきれなければ、これまでどおり列から読み直す形へ落とす', () => {
    // 消すべき本文の持ち主が分からないとき。二重のまま書かせない
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ id: 'a', userId: 'a', joinedAt: 100 }], BASE, NEWER)
    const rogue = new Y.Doc()
    applyMarkdown(rogue, EXTRA)
    rogue.getMap('seeds').set('ffffffffffffffff', '')
    hub.sendAs('rogue-tab', 'y-update', Y.encodeStateAsUpdate(rogue))

    expect(a.degraded).toContain('duplicate-seed')
  })
})

describe('大きすぎるとき', () => {
  /** 1通の上限を超える大きさにする（本文とは別の場所を膨らませる） */
  function bloat(doc: Y.Doc): void {
    doc.getText('bloat').insert(0, 'a'.repeat(MAX_MESSAGE_CHARS))
  }

  it('渡せないほど大きいときは、空で返して相手に知らせる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    bloat(tanaka.session.doc)
    // まとめる幅は進めない（進めると、この大きさを配れずに田中自身が先に落ちる）
    hub.sent.length = 0

    const yamada = join(hub, 'yamada', [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ])

    const answers = hub.sent.filter((s) => s.event === 'y-sync2')
    expect(answers).toHaveLength(1)
    expect(answers[0].payload).toBe('')
    // 受け取った側は本文を持っていないので、1人で書く形に落ちる
    expect(yamada.degraded).toContain('too-large')
    expect(yamada.session.isSynced).toBe(false)
  })

  it('打った分が大きすぎるときは、打った本人が落ちる（黙って消さない）', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    join(hub, 'yamada', [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ])

    bloat(tanaka.session.doc)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    expect(tanaka.degraded).toContain('too-large')
  })
})

describe('タスク化のあとの読み直し', () => {
  it('部屋のみんなに伝わる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ])

    tanaka.session.requestRoomReload()

    expect(yamada.reloads).toBe(1)
    // 送った本人には返ってこない（自分で読み直すので二重にならない）
    expect(tanaka.reloads).toBe(0)
  })
})

describe('宛先', () => {
  it('自分宛でない通は読まない', () => {
    const hub = createFakeHub()
    join(hub, 'tanaka', [{ id: 'tanaka', userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', [
      { id: 'tanaka', userId: 'tanaka', joinedAt: 100 },
      { id: 'yamada', userId: 'yamada', joinedAt: 200 },
    ])
    const before = readBackMarkdown(yamada.session.doc)

    // 田中が「鈴木宛」に本文の更新を送る
    const other = new Y.Doc()
    applyMarkdown(other, `${BASE}\n- 鈴木だけに見える行`)
    hub.sendAs('tanaka', 'y-update', Y.encodeStateAsUpdate(other), 'suzuki')

    expect(readBackMarkdown(yamada.session.doc)).toBe(before)
  })
})

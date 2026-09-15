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
import { createFakeHub } from './fakeTransport'
import { applyMarkdown, readBackMarkdown, seedWith } from './minutesTestSchema'

const BASE = ['# 会議', '', '- 決めたこと'].join('\n')

interface Member {
  session: MinutesCollabSession
  degraded: DegradeReason[]
  reloads: number
}

/** 部屋の顔ぶれ。`joinedAt` が小さいほど古株 */
type Room = { userId: string; joinedAt: number }[]

const members: Member[] = []

/**
 * 部屋に入る。実際の画面では在席の一覧から顔ぶれを組み立てるが、ここでは直接渡す。
 * 既に居る人にも同じ顔ぶれを伝える（在席は全員に配られるため）。
 */
function join(
  hub: ReturnType<typeof createFakeHub>,
  userId: string,
  room: Room,
  markdown = BASE
): Member {
  const degraded: DegradeReason[] = []
  const member: Member = {
    degraded,
    reloads: 0,
    session: new MinutesCollabSession({
      selfId: userId,
      transport: hub.transportFor(userId),
      onDegrade: (reason) => degraded.push(reason),
      onRoomReload: () => {
        member.reloads += 1
      },
    }),
  }
  member.session.setSeeder(seedWith(markdown))
  members.push(member)
  // 在席は全員に配られる。入る前から居た人にも新しい顔ぶれが届く
  for (const existing of members) existing.session.setPeers(room)
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
    expect(tanaka.session.isSynced).toBe(true)
  })

  it('先客が居れば、その人から本文を受け取って同じ内容になる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', [
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
    ])

    expect(yamada.session.isSynced).toBe(true)
    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
  })

  it('先客が居るときは、自分の本文で器を作り直さない', () => {
    // 田中が開いたあとに外から1行足された、という場面。山田の列は新しいが、
    // 部屋の器（田中が作ったもの）に合わせる。作り直すと本文が二重になる
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(
      hub,
      'yamada',
      [
        { userId: 'tanaka', joinedAt: 100 },
        { userId: 'yamada', joinedAt: 200 },
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
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
    ]
    join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    join(hub, 'yamada', room2)
    hub.sent.length = 0

    join(hub, 'suzuki', [...room2, { userId: 'suzuki', joinedAt: 300 }])

    const answers = hub.sent.filter((s) => s.event === 'y-sync2')
    expect(answers).toHaveLength(1)
    expect(answers[0].from).toBe('tanaka')
  })

  it('誰も返事をくれなければ、2回試してから自分で種をまく', () => {
    const hub = createFakeHub()
    // 部屋には先客が居ることになっているが、実際には返事が返らない
    const yamada = join(hub, 'yamada', [
      { userId: 'ghost', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
    ])

    expect(yamada.session.isSynced).toBe(false)
    vi.advanceTimersByTime(SYNC_WAIT_MS)
    expect(yamada.session.isSynced).toBe(false)
    vi.advanceTimersByTime(SYNC_WAIT_MS)

    expect(yamada.session.isSynced).toBe(true)
    expect(readBackMarkdown(yamada.session.doc)).toBe(BASE)
    expect(hub.sent.filter((s) => s.event === 'y-sync1' && !s.to)).toHaveLength(2)
  })

  it('本文を持っていない人は返事をしない（空の器を配らない）', () => {
    const hub = createFakeHub()
    const room: Room = [
      { userId: 'a', joinedAt: 100 },
      { userId: 'b', joinedAt: 200 },
    ]
    // a も b も先客が居ることになっていて、どちらも本文を持っていない
    const a = join(hub, 'a', [{ userId: 'ghost', joinedAt: 50 }, ...room])
    hub.sent.length = 0
    join(hub, 'b', [{ userId: 'ghost', joinedAt: 50 }, ...room])

    expect(hub.sent.filter((s) => s.event === 'y-sync2')).toHaveLength(0)
    expect(a.session.isSynced).toBe(false)
  })
})

describe('切れて入り直したとき', () => {
  it('入り直した人が切れている間に打った分も、部屋へ届く', () => {
    const hub = createFakeHub()
    const room: Room = [
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
    ]
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    // 山田が切れる（運び役から外れる）。その間に双方が別の場所を打つ
    yamada.session.setPeers(room)
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
    { userId: 'tanaka', joinedAt: 100 },
    { userId: 'yamada', joinedAt: 200 },
  ]

  it('まとめて相手へ届く', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    const typed = `${BASE}\n- 山田が足した行`
    applyMarkdown(yamada.session.doc, typed)

    expect(readBackMarkdown(tanaka.session.doc)).toBe(BASE)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)
    expect(readBackMarkdown(tanaka.session.doc)).toBe(typed)
  })

  it('打ち続けても、まとめる幅ごとに1通だけ送る', () => {
    const hub = createFakeHub()
    join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', room)

    applyMarkdown(yamada.session.doc, `${BASE}\n- 閉じる直前に書いた`)
    // まとめる幅を待たずに閉じる
    yamada.session.destroy()

    expect(readBackMarkdown(tanaka.session.doc)).toContain('閉じる直前に書いた')
  })
})

describe('カーソル', () => {
  const room: Room = [
    { userId: 'tanaka', joinedAt: 100 },
    { userId: 'yamada', joinedAt: 200 },
  ]

  it('1秒に1回までしか送らない', () => {
    const hub = createFakeHub()
    join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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
    { userId: 'a', joinedAt: 100 },
    { userId: 'b', joinedAt: 200 },
  ]

  it('違う本文から種が2つ入ったら落とす', () => {
    const hub = createFakeHub()
    // どちらも「先客が居る」と思っているが返事は来ない。猶予切れで各自がまく
    const a = join(hub, 'a', [{ userId: 'ghost', joinedAt: 50 }, ...room], BASE)
    const b = join(hub, 'b', [{ userId: 'ghost', joinedAt: 50 }, ...room], `${BASE}\n- 違う行`)
    vi.advanceTimersByTime(SYNC_WAIT_MS * 2)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    expect([...a.degraded, ...b.degraded]).toContain('duplicate-seed')
  })

  it('同じ本文なら、2人同時にまいても二重にならない', () => {
    const hub = createFakeHub()
    const a = join(hub, 'a', [{ userId: 'ghost', joinedAt: 50 }, ...room])
    const b = join(hub, 'b', [{ userId: 'ghost', joinedAt: 50 }, ...room])
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
    session.setPeers([{ userId: 'tanaka', joinedAt: 100 }])
    session.start()

    expect(degraded).toEqual(['transport-error'])
    expect(session.isDegraded).toBe(true)
  })

  it('送れなくなったら落とし、以後は送らない', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
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

describe('大きすぎるとき', () => {
  /** 1通の上限を超える大きさにする（本文とは別の場所を膨らませる） */
  function bloat(doc: Y.Doc): void {
    doc.getText('bloat').insert(0, 'a'.repeat(MAX_MESSAGE_CHARS))
  }

  it('渡せないほど大きいときは、空で返して相手に知らせる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    bloat(tanaka.session.doc)
    // まとめる幅は進めない（進めると、この大きさを配れずに田中自身が先に落ちる）
    hub.sent.length = 0

    const yamada = join(hub, 'yamada', [
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    join(hub, 'yamada', [
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
    ])

    bloat(tanaka.session.doc)
    vi.advanceTimersByTime(UPDATE_FLUSH_MS)

    expect(tanaka.degraded).toContain('too-large')
  })
})

describe('タスク化のあとの読み直し', () => {
  it('部屋のみんなに伝わる', () => {
    const hub = createFakeHub()
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', [
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
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
    const tanaka = join(hub, 'tanaka', [{ userId: 'tanaka', joinedAt: 100 }])
    const yamada = join(hub, 'yamada', [
      { userId: 'tanaka', joinedAt: 100 },
      { userId: 'yamada', joinedAt: 200 },
    ])
    const before = readBackMarkdown(yamada.session.doc)

    // 田中が「鈴木宛」に本文の更新を送る
    const other = new Y.Doc()
    applyMarkdown(other, `${BASE}\n- 鈴木だけに見える行`)
    hub.sendAs('tanaka', 'y-update', Y.encodeStateAsUpdate(other), 'suzuki')

    expect(readBackMarkdown(yamada.session.doc)).toBe(before)
  })
})

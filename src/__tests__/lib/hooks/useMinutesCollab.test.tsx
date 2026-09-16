// @vitest-environment jsdom
/**
 * 同時編集の組み立て（`useMinutesCollab`）。
 *
 * ここで守りたいのは3つ。
 *  1. **入ったばかりの人が書記を横取りしない**。在席の一覧は参加の返事より後に別便で
 *     届くので、参加した瞬間に決めると必ず「自分しか居ない」と見える。
 *  2. **エディタが遅れて載っても止まらない**。器は使うときだけ読み込むので、
 *     つながる方が先になることがある。つながった知らせを取りこぼすと画面が空のまま。
 *  3. **本文が入る前に落ちたら、器につながずに1人用のエディタへ載せ替える**。
 *     つないだままだと、空のエディタに打った1文字で議事録が丸ごと消える。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Doc as YDoc } from 'yjs'
import { useMinutesCollab } from '@/lib/hooks/useMinutesCollab'
import type { MinutesCollabWiring, MinutesPresencePeer } from '@/lib/hooks/useMinutesPresence'
import { readBackMarkdown, seedWith } from '../collab/minutesTestSchema'

const BASE = ['# 会議', '', '- 決めたこと'].join('\n')

let capturedCollab: MinutesCollabWiring | undefined
/** このタブの見分け札。同時編集のフックが作って在席へ渡す */
let capturedTabId = ''
let othersState: MinutesPresencePeer[] = []
const sendCollabSpy = vi.fn()
const setCollabActiveSpy = vi.fn()

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: (options: { collab?: MinutesCollabWiring; tabId: string }) => {
    capturedCollab = options.collab
    capturedTabId = options.tabId
    return {
      others: othersState,
      setEditing: vi.fn(),
      sendCollab: sendCollabSpy,
      setCollabActive: setCollabActiveSpy,
    }
  },
}))

/**
 * 器（合流の本体）は**使うときだけ読み込む**ので、取り込みが終わるまで待つ。
 * 会議ページを開いただけで yjs 一式が落ちてこないようにするための作りで、
 * その待ちがそのままここにも出る。
 */
async function mount(initialMarkdown = BASE) {
  const rendered = renderHook(() =>
    useMinutesCollab({
      meetingId: 'm1',
      presenceEnabled: true,
      self: { userId: 'u-self', name: '自分' },
      collabAllowed: true,
      initialMarkdown,
    })
  )
  await settle(() => rendered.result.current.pending === false)
  return rendered
}

/**
 * 用意が終わるまで、何度か手番を譲って待つ。
 * 取り込みは非同期で、しかも最初の1回はモジュールを読みに行くぶん時間がかかる。
 */
async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    if (done()) return
  }
}

/** 器の中身を Markdown で読む */
function docOf(fragment: unknown): YDoc {
  return (fragment as { doc: YDoc }).doc
}

/**
 * 部屋の顔ぶれが届いたことにする（在席の一覧は参加の返事より後に来る）。
 * `id` はタブごとの見分け札。`'self'` と書いたら、このタブ自身に読み替える。
 */
function announce(peers: { id: string; userId?: string; joinedAt: number; collab?: boolean }[]) {
  act(() =>
    capturedCollab?.onPeers(
      peers.map((peer) => ({
        collab: true,
        userId: peer.userId ?? (peer.id === 'self' ? 'u-self' : peer.id),
        ...peer,
        id: peer.id === 'self' ? capturedTabId : peer.id,
      }))
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedCollab = undefined
  capturedTabId = ''
  othersState = []
})

describe('書記の決め方', () => {
  it('部屋の顔ぶれが分かるまでは、誰が保存するか決めない', async () => {
    const { result } = await mount()
    expect(result.current.isScribe).toBe(false)
  })

  it('先に入っていた人が居れば、その人が書記（自分は保存しない）', async () => {
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([
      { id: 'self', userId: 'self', joinedAt: 2_000 },
      { id: 'u-old', userId: 'u-old', joinedAt: 1_000 },
    ])
    act(() => capturedCollab?.onStatus('joined'))

    expect(result.current.isScribe).toBe(false)
  })

  it('自分しか居なければ自分が書記になり、列の本文で器を満たす', async () => {
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([{ id: 'self', userId: 'self', joinedAt: 2_000 }])
    act(() => capturedCollab?.onStatus('joined'))

    expect(readBackMarkdown(docOf(result.current.fragment))).toBe(BASE)
    expect(result.current.isScribe).toBe(true)
  })

  it('本文の入った器を持ってから、はじめて在席で輪に入っていると名乗る', async () => {
    // 名乗るのが早すぎると、器を持っていない自分が書記に選ばれ、
    // **部屋の誰の書いた内容も列に残らなくなる**（スマホ・読み込み失敗のときに起きる）
    const { result } = await mount()
    expect(setCollabActiveSpy).not.toHaveBeenCalledWith(true)

    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([{ id: 'self', userId: 'self', joinedAt: 2_000 }])
    act(() => capturedCollab?.onStatus('joined'))

    expect(setCollabActiveSpy).toHaveBeenCalledWith(true)
  })

  it('本文が入るまでは、書記でも保存する係にならない', async () => {
    // 空の器の中身で議事録を上書きしないため
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([
      { id: 'self', userId: 'self', joinedAt: 1_000 },
      { id: 'u-other', userId: 'u-other', joinedAt: 2_000 },
    ])
    // 顔ぶれ上は自分が書記だが、まだ誰からも本文をもらっていない
    expect(result.current.synced).toBe(false)
    expect(result.current.isScribe).toBe(false)
  })
})

describe('エディタが遅れて載る場合', () => {
  it('つながったあとにエディタが載っても、器に本文が入る', async () => {
    const { result } = await mount()
    announce([{ id: 'self', userId: 'self', joinedAt: 2_000 }])
    act(() => capturedCollab?.onStatus('joined'))
    expect(readBackMarkdown(docOf(result.current.fragment))).toBe('')

    act(() => result.current.registerSeeder(seedWith(BASE)))
    expect(readBackMarkdown(docOf(result.current.fragment))).toBe(BASE)
  })
})

describe('本文が入る前に落ちたとき', () => {
  it('器につながずに1人用のエディタへ載せ替える', async () => {
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([{ id: 'self', userId: 'self', joinedAt: 2_000 }])
    act(() => capturedCollab?.onStatus('error'))

    expect(result.current.solo).toBe(true)
    expect(result.current.fragment).toBeNull()
    expect(result.current.awareness).toBeNull()
    // 1人用なので、これまでどおり自分で保存し、すぐ書ける
    expect(result.current.isScribe).toBe(true)
    expect(result.current.synced).toBe(true)
  })

  it('落ちたことを在席で知らせる（落ちた人を書記に選ばせない）', async () => {
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([{ id: 'self', userId: 'self', joinedAt: 2_000 }])
    act(() => capturedCollab?.onStatus('error'))

    expect(setCollabActiveSpy).toHaveBeenCalledWith(false)
  })

  it('本文が入ったあとに落ちたときは、器を残したまま自分が保存係になる', async () => {
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    announce([{ id: 'self', userId: 'self', joinedAt: 2_000 }])
    act(() => capturedCollab?.onStatus('joined'))
    expect(result.current.synced).toBe(true)

    act(() => capturedCollab?.onStatus('error'))

    expect(result.current.solo).toBe(false)
    expect(result.current.fragment).not.toBeNull()
    expect(result.current.isScribe).toBe(true)
  })
})

describe('1つ前の版の画面が混ざっているとき', () => {
  it('こちらが輪から降りて、これまでどおり自分で保存する', async () => {
    // 相手は人ごとに数えているので、こちらが指した返事役に応えられない。
    // 無理に輪を作ると、待ちぼうけの末に各自が種をまいて本文が二重になる
    const { result } = await mount()
    act(() => result.current.registerSeeder(seedWith(BASE)))
    act(() =>
      capturedCollab?.onPeers([
        { id: capturedTabId, userId: 'u-self', joinedAt: 2_000, collab: true },
        { id: 'u-old', userId: 'u-old', joinedAt: 1_000, collab: true, outdated: true },
      ])
    )

    expect(result.current.degradedReason).toBe('peer-outdated')
    expect(result.current.active).toBe(false)
    expect(result.current.isScribe).toBe(true)
  })

  it('器ができる前に印を受け取っても、種をまかない', async () => {
    // 器は使うときだけ読み込むので、取り込みが終わる前に在席が届くことがある。
    // そこで受け取った印を覚えておかないと、あとからできた器が縮退しておらず、
    // 「自分ひとりだ」と見えて種をまき、古い画面の器と食い違って本文が二重になる
    const rendered = renderHook(() =>
      useMinutesCollab({
        meetingId: 'm1',
        presenceEnabled: true,
        self: { userId: 'u-self', name: '自分' },
        collabAllowed: true,
        initialMarkdown: BASE,
      })
    )
    act(() =>
      capturedCollab?.onPeers([{ id: 'u-old', userId: 'u-old', joinedAt: 1_000, collab: true, outdated: true }])
    )
    await settle(() => rendered.result.current.pending === false)
    act(() => rendered.result.current.registerSeeder(seedWith(BASE)))

    expect(rendered.result.current.degradedReason).toBe('peer-outdated')
    expect(rendered.result.current.solo).toBe(true)
    expect(rendered.result.current.fragment).toBeNull()
  })
})

describe('使わない場合', () => {
  it('組織で開いていなければ、器そのものを作らない', async () => {
    const { result } = renderHook(() =>
      useMinutesCollab({
        meetingId: 'm1',
        presenceEnabled: true,
        self: { userId: 'u-self', name: '自分' },
        collabAllowed: false,
        initialMarkdown: BASE,
      })
    )
    await settle(() => result.current.pending === false)
    expect(result.current.fragment).toBeNull()
    expect(result.current.pending).toBe(false)
    expect(result.current.active).toBe(false)
    expect(result.current.solo).toBe(true)
    // これまでどおり自分で保存する
    expect(result.current.isScribe).toBe(true)
  })

  it('長すぎる議事録では使わない', async () => {
    const { result } = await mount('あ'.repeat(100_001))
    expect(result.current.fragment).toBeNull()
    expect(result.current.isScribe).toBe(true)
  })
})

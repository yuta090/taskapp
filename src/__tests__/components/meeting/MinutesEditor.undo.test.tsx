// @vitest-environment jsdom
/**
 * 同時編集のときに Ctrl+Z / Cmd+Z（取り消し）が効くかを、本物の BlockNote で確かめる。
 *
 * 本番と同じ順番を再現するのが肝: **エディタを載せてから、あとで本文の種をまく**。
 * 議事録は器（Y.XmlFragment）の中身が正本なので、載せる時点では器が空になる。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { BlockNoteEditor } from '@blocknote/core'
import { MinutesCollabSession, UPDATE_FLUSH_MS } from '@/lib/collab/session'
import { seedMinutesDoc } from '@/lib/collab/seed'
import { MINUTES_FRAGMENT_NAME } from '@/lib/collab/hash'
import { MinutesEditor, type MinutesEditorApi } from '@/components/meeting/MinutesEditor'
import { createFakeHub } from '../../lib/collab/fakeTransport'
import { minutesTestSchema, schemaProbe, seedWith } from '../../lib/collab/minutesTestSchema'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// BlockNote の見た目は Mantine 経由で色の設定を読む。jsdom には無いので足す
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

type AnyEditor = BlockNoteEditor<never, never, never>

const mounted: { editor: AnyEditor; host: HTMLElement }[] = []
const sessions: MinutesCollabSession[] = []

function mountEditor(fragment: Y.XmlFragment, awareness: Awareness): AnyEditor {
  const editor = BlockNoteEditor.create({
    schema: minutesTestSchema,
    collaboration: {
      fragment,
      user: { name: 'テスト', color: '#4f46e5' },
      provider: { awareness },
    },
  } as never) as AnyEditor
  const host = document.createElement('div')
  document.body.appendChild(host)
  editor.mount(host)
  mounted.push({ editor, host })
  return editor
}

/** 議事録の本文を書き換える（キーボードで打つのと同じ経路＝ProseMirror の取引） */
function typeInto(editor: AnyEditor, index: number, text: string): void {
  const target = editor.document[index] as { id: string }
  editor.updateBlock(target as never, {
    content: [{ type: 'text', text, styles: {} }],
  } as never)
}

function textAt(editor: AnyEditor, index: number): string {
  const block = editor.document[index] as { content?: { text?: string }[] } | undefined
  return block?.content?.map((part) => part.text ?? '').join('') ?? ''
}

afterEach(() => {
  while (sessions.length) sessions.pop()?.destroy()
  while (mounted.length) {
    const entry = mounted.pop()
    entry?.editor.unmount()
    entry?.host.remove()
  }
})

describe('同時編集中の取り消し（Ctrl+Z / Cmd+Z）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('エディタだけなら、打った文字を取り消せる', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const editor = mountEditor(doc.getXmlFragment(MINUTES_FRAGMENT_NAME), awareness)
    seedMinutesDoc(doc, '# 議題\n\nもとの行', schemaProbe.pmSchema, minutesTestSchema.styleSchema)

    typeInto(editor, 1, 'あとから打った行')
    expect(textAt(editor, 1)).toBe('あとから打った行')

    editor.undo()
    expect(textAt(editor, 1)).toBe('もとの行')
  })

  /**
   * ここは BlockNote / y-prosemirror 側のふるまいを写し取っておくための確かめ。
   * **エディタをいったん外すと、取り消しの控えを持っている係が片付けられ、
   * 載せ直しても作り直されない**（画面が外れるときに `undoManager.destroy()` が
   * 呼ばれ、載せ直しでは持ち物がそのまま引き継がれるため、死んだ係が残る）。
   * だから議事録のエディタは、読み書きの切り替えでエディタを載せ直させない。
   *
   * **この検査が落ちたら良い知らせ**（BlockNote か y-prosemirror の側が直った合図）。
   * そのときは下の「変わっても取り消しは効き続ける」だけ残せばよい。
   */
  it('いったん外して載せ直すと、そのあとは取り消しが効かなくなる', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const editor = mountEditor(doc.getXmlFragment(MINUTES_FRAGMENT_NAME), awareness)
    const host = mounted[mounted.length - 1].host
    seedMinutesDoc(doc, '# 議題\n\nもとの行', schemaProbe.pmSchema, minutesTestSchema.styleSchema)

    editor.unmount()
    editor.mount(host)

    typeInto(editor, 1, 'あとから打った行')
    editor.undo()

    expect(textAt(editor, 1)).toBe('あとから打った行')
  })

  it('同時編集につないでも、自分が打った文字を取り消せる', () => {
    const hub = createFakeHub()
    const session = new MinutesCollabSession({
      selfId: 'tab-a',
      transport: hub.transportFor('tab-a'),
      onDegrade: () => {},
      onRoomReload: () => {},
    })
    sessions.push(session)
    const editor = mountEditor(session.fragment, session.awareness)
    session.setSeeder(seedWith('# 議題\n\nもとの行'))
    session.setPeers([{ id: 'tab-a', userId: 'u-a', joinedAt: 1, collab: false, present: true }])
    session.start()
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 2)

    expect(textAt(editor, 1)).toBe('もとの行')

    typeInto(editor, 1, 'あとから打った行')
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 2)
    expect(textAt(editor, 1)).toBe('あとから打った行')

    editor.undo()
    expect(textAt(editor, 1)).toBe('もとの行')
  })

  it('相手の編集が流れ込んだあとでも、自分が打った文字だけを取り消せる', () => {
    const hub = createFakeHub()
    const open = (tabId: string, joinedAt: number) => {
      const session = new MinutesCollabSession({
        selfId: tabId,
        transport: hub.transportFor(tabId),
        onDegrade: () => {},
        onRoomReload: () => {},
      })
      sessions.push(session)
      const editor = mountEditor(session.fragment, session.awareness)
      session.setSeeder(seedWith('# 議題\n\nもとの行'))
      return { session, editor, joinedAt }
    }

    const a = open('tab-a', 1)
    const room = [{ id: 'tab-a', userId: 'u-a', joinedAt: 1, collab: false, present: true }]
    a.session.setPeers(room)
    a.session.start()
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 2)

    const b = open('tab-b', 2)
    room.push({ id: 'tab-b', userId: 'u-b', joinedAt: 2, collab: false, present: true })
    room[0].collab = true
    a.session.setPeers(room)
    b.session.setPeers(room)
    b.session.start()
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 4)

    expect(textAt(b.editor, 1)).toBe('もとの行')

    // 自分（A）が打つ → 相手（B）が別の行を打つ → A に流れ込む
    typeInto(a.editor, 1, 'Aが打った行')
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 2)
    typeInto(b.editor, 0, 'Bが直した見出し')
    vi.advanceTimersByTime(UPDATE_FLUSH_MS * 2)

    expect(textAt(a.editor, 0)).toBe('Bが直した見出し')
    expect(textAt(a.editor, 1)).toBe('Aが打った行')

    a.editor.undo()

    // 自分の1行だけ戻り、相手の直しは残る
    expect(textAt(a.editor, 1)).toBe('もとの行')
    expect(textAt(a.editor, 0)).toBe('Bが直した見出し')
  })
})

// =====================================================================================
// 画面の部品（MinutesEditor）として見たときの確かめ。
// 議事録は同時編集のとき「本文が器に届くのを待つ → 届いたら書ける」と進むので、
// その途中で「書ける/書けない」を変えないことが取り消しの前提になる。
// =====================================================================================

describe('MinutesEditor: 取り消し（Ctrl+Z / Cmd+Z）', () => {
  /** 本番と同じ形で議事録のエディタを出す。器は空のまま載せ、あとから種をまく */
  function open(editable: boolean) {
    const doc = new Y.Doc()
    const collaboration = {
      fragment: doc.getXmlFragment(MINUTES_FRAGMENT_NAME),
      awareness: new Awareness(doc),
      userName: 'テスト',
      colorIndex: 0,
    }
    let api: MinutesEditorApi | null = null
    const props = (next: boolean) => ({
      minutesMd: '',
      orgId: 'org-1',
      spaceId: 'space-1',
      editable: next,
      collaboration,
      registerApi: (value: MinutesEditorApi | null) => {
        api = value
      },
    })
    const view = render(<MinutesEditor {...props(editable)} />)
    return {
      doc,
      view,
      getApi: () => api,
      rerenderWith: (next: boolean) => view.rerender(<MinutesEditor {...props(next)} />),
      body: () => view.container.querySelector('[contenteditable]') as HTMLElement,
    }
  }

  function pressUndo(body: HTMLElement) {
    body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })
    )
  }

  it('書ける状態のまま載せれば、Ctrl+Z で打つ前に戻る', async () => {
    const screen = open(true)
    await act(async () => {
      screen.getApi()?.seedCollabDoc(screen.doc, '# 議題\n\nもとの行')
    })
    await act(async () => {
      screen.getApi()?.appendMarkdown('あとから足した行')
    })
    expect(screen.body().textContent).toContain('あとから足した行')

    await act(async () => {
      pressUndo(screen.body())
    })

    expect(screen.body().textContent).not.toContain('あとから足した行')
    expect(screen.body().textContent).toContain('もとの行')
    screen.view.unmount()
  })

  /**
   * 本番でいちばん起きる形。同時編集では**本文が器に届くまで読み取り専用**なので、
   * 議事録を開くたびに「書けない → 書ける」が1回起きる。
   */
  it('本文が届いて書ける状態に変わっても、Ctrl+Z は効き続ける', async () => {
    const screen = open(false)
    await act(async () => {
      screen.getApi()?.seedCollabDoc(screen.doc, '# 議題\n\nもとの行')
    })
    await act(async () => {
      screen.rerenderWith(true)
    })
    await act(async () => {
      screen.getApi()?.appendMarkdown('あとから足した行')
    })
    expect(screen.body().textContent).toContain('あとから足した行')

    await act(async () => {
      pressUndo(screen.body())
    })

    expect(screen.body().textContent).not.toContain('あとから足した行')
    expect(screen.body().textContent).toContain('もとの行')
    screen.view.unmount()
  })

  /**
   * タスク化のあいだは読み取り専用に倒し、終わると戻る。**失敗して戻ったとき**は
   * 画面を作り直さないので、ここで取り消しが死ぬと以後ずっと効かない。
   */
  it('読み取り専用に倒して戻しても、Ctrl+Z は効き続ける', async () => {
    const screen = open(true)
    await act(async () => {
      screen.getApi()?.seedCollabDoc(screen.doc, '# 議題\n\nもとの行')
    })
    await act(async () => {
      screen.rerenderWith(false)
    })
    await act(async () => {
      screen.rerenderWith(true)
    })
    await act(async () => {
      screen.getApi()?.appendMarkdown('あとから足した行')
    })

    await act(async () => {
      pressUndo(screen.body())
    })

    expect(screen.body().textContent).not.toContain('あとから足した行')
    screen.view.unmount()
  })

  /** 載せ直さない形にしても、読み取り専用そのものは本当に効いていること */
  it('読み取り専用に変えたら、その場で書けなくなる', async () => {
    const screen = open(true)
    await act(async () => {
      screen.getApi()?.seedCollabDoc(screen.doc, '# 議題\n\nもとの行')
    })
    expect(screen.body().getAttribute('contenteditable')).toBe('true')

    await act(async () => {
      screen.rerenderWith(false)
    })

    expect(screen.body().getAttribute('contenteditable')).toBe('false')
    // 読めるだけの本文にも、キーボードだけで入れること
    expect(screen.body().getAttribute('tabindex')).toBe('0')
    // 差し込み口も「いまは無理」を返す（AI秘書の末尾追記を空振りさせない）
    expect(screen.getApi()?.appendMarkdown('入れてはいけない行')).toBe('busy')
    expect(screen.body().textContent).not.toContain('入れてはいけない行')
    screen.view.unmount()
  })
})

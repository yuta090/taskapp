import React, { useContext } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const createPoll = vi.fn()
const castVote = vi.fn()
let polls: Record<string, unknown> = {}
let isFetched = true
vi.mock('@/lib/hooks/useDocPolls', () => ({
  useDocPolls: () => ({ polls, isFetched, castVote, createPoll }),
}))

import { DocPollHost, type DocPollEditorLike } from '@/components/editor/docPoll/DocPollHost'
import { DocPollContext } from '@/components/editor/docPoll/docPollBlock'
import { DOC_POLL_TYPE } from '@/lib/doc-polls/logic'

type Blk = { id: string; type: string; props: Record<string, unknown>; children?: Blk[] }
const poll = (id: string, pollId: string, reasonRequired = 'none'): Blk => ({
  id,
  type: DOC_POLL_TYPE,
  props: { pollId, reasonRequired },
})

const setMeta = vi.fn()
let changeListener: (() => void) | null = null

function fakeEditor(doc: Blk[]) {
  const editor: DocPollEditorLike & { document: Blk[] } = {
    document: doc,
    onChange: vi.fn((cb: () => void) => {
      changeListener = cb
      return () => {}
    }),
    transact: vi.fn((cb: (tr: { setMeta: typeof setMeta }) => unknown) => cb({ setMeta })),
    updateBlock: vi.fn((block: { id: string }, update: { props: Record<string, unknown> }) => {
      const b = editor.document.find((x) => x.id === block.id)!
      b.props = { ...b.props, ...update.props }
    }),
  }
  return editor
}

function Probe({ onValue }: { onValue: (v: unknown) => void }) {
  onValue(useContext(DocPollContext))
  return null
}

function mount(editor: DocPollEditorLike, editable = true, onValue: (v: unknown) => void = () => {}) {
  return render(
    <DocPollHost
      editor={editor}
      source={{ wikiPageId: 'w1' }}
      currentUserId="me"
      nameOf={() => '高橋'}
      editable={editable}
    >
      <Probe onValue={onValue} />
    </DocPollHost>
  )
}

beforeEach(() => {
  setMeta.mockReset()
  changeListener = null
  createPoll.mockReset().mockResolvedValue(undefined)
  polls = {}
  isFetched = true
})

describe('DocPollHost', () => {
  it('中の投票ブロックに、その文書の投票と押し方を配る', () => {
    polls = { p1: { poll: { id: 'p1' }, votes: [], events: [] } }
    let got: { polls: unknown; currentUserId: string; canCreate: boolean } | null = null
    mount(fakeEditor([]), false, (v) => { got = v as typeof got })
    expect(got).toMatchObject({ polls, currentUserId: 'me', canCreate: false })
  })

  it('DB に無い投票を、理由必須の設定ごと作る', async () => {
    polls = { p2: {} }
    mount(fakeEditor([poll('b1', 'p1', 'ng_hold'), poll('b2', 'p2')]))
    await waitFor(() => expect(createPoll).toHaveBeenCalledWith('p1', 'ng_hold'))
    expect(createPoll).toHaveBeenCalledTimes(1)
  })

  it('同じ番号が2つあれば、後ろのブロックを新しい番号にして作る', async () => {
    polls = { p1: {} }
    const editor = fakeEditor([poll('b1', 'p1'), poll('b2', 'p1')])
    mount(editor)
    await waitFor(() => expect(editor.updateBlock).toHaveBeenCalledTimes(1))
    const next = editor.document[1].props.pollId as string
    expect(next).not.toBe('p1')
    expect(editor.document[0].props.pollId).toBe('p1')
    await waitFor(() => expect(createPoll).toHaveBeenCalledWith(next, 'none'))
  })

  it('別の文書の番号だった（使用中）ら、新しい番号にして作り直す', async () => {
    createPoll.mockRejectedValueOnce({ code: '22023', message: 'poll_id_in_use' })
    const editor = fakeEditor([poll('b1', 'pX')])
    mount(editor)
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(2))
    const next = editor.document[0].props.pollId as string
    expect(next).not.toBe('pX')
    expect(createPoll).toHaveBeenLastCalledWith(next, 'none')
  })

  it('振り直しは「元に戻す」の履歴に載せない（Ctrl+Z で貼り付けまで戻れるように）', async () => {
    polls = { p1: {} }
    const editor = fakeEditor([poll('b1', 'p1'), poll('b2', 'p1')])
    mount(editor)
    await waitFor(() => expect(editor.updateBlock).toHaveBeenCalledTimes(1))
    expect(setMeta).toHaveBeenCalledWith('addToHistory', false)
  })

  it('元の投票の上に貼っても、前からあったブロックが票を持ち続ける', async () => {
    polls = { p1: {} }
    const editor = fakeEditor([poll('b1', 'p1')])
    mount(editor)
    await new Promise((r) => setTimeout(r, 10))
    // 上に貼った（BlockNote は貼ったブロックに新しい id を振る）
    editor.document = [poll('b9', 'p1'), editor.document[0]]
    changeListener?.()
    await waitFor(() => expect(editor.updateBlock).toHaveBeenCalledTimes(1))
    expect(editor.document.find((b) => b.id === 'b1')?.props?.pollId).toBe('p1')
    expect(editor.document.find((b) => b.id === 'b9')?.props?.pollId).not.toBe('p1')
  })

  it('一瞬つながらなかっただけなら、1回だけ作り直す', async () => {
    createPoll.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(undefined)
    let got: { failedIds: ReadonlySet<string> } | null = null
    mount(fakeEditor([poll('b1', 'p1')]), true, (v) => { got = v as typeof got })
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(got!.failedIds.has('p1')).toBe(false)
  })

  it('作り直しても作れなければ、そのブロックに案内を出す（用意中のまま止めない）', async () => {
    createPoll.mockRejectedValue(new Error('fetch failed'))
    let got: { failedIds: ReadonlySet<string> } | null = null
    mount(fakeEditor([poll('b1', 'p1')]), true, (v) => { got = v as typeof got })
    await waitFor(() => expect(got!.failedIds.has('p1')).toBe(true), { timeout: 3000 })
    expect(createPoll).toHaveBeenCalledTimes(2)
  })

  it('権限が無くて作れないときは作り直さず、すぐ案内を出す', async () => {
    createPoll.mockRejectedValue({ code: '42501', message: 'forbidden' })
    let got: { failedIds: ReadonlySet<string> } | null = null
    mount(fakeEditor([poll('b1', 'p1')]), true, (v) => { got = v as typeof got })
    await waitFor(() => expect(got!.failedIds.has('p1')).toBe(true))
    expect(createPoll).toHaveBeenCalledTimes(1)
  })

  it('権限などで作れなかった番号は、何度も作りに行かない', async () => {
    createPoll.mockRejectedValue({ code: '42501', message: 'forbidden' })
    const editor = fakeEditor([poll('b1', 'p1')])
    const { rerender } = mount(editor)
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1))
    rerender(
      <DocPollHost editor={editor} source={{ wikiPageId: 'w1' }} currentUserId="me" nameOf={() => ''} editable>
        <span />
      </DocPollHost>
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(createPoll).toHaveBeenCalledTimes(1)
  })

  it('編集できない人の画面では作らない・振り直さない', async () => {
    const editor = fakeEditor([poll('b1', 'p1'), poll('b2', 'p1')])
    mount(editor, false)
    await new Promise((r) => setTimeout(r, 10))
    expect(createPoll).not.toHaveBeenCalled()
    expect(editor.updateBlock).not.toHaveBeenCalled()
  })

  it('読み込みが終わるまでは作らない（まだ知らないだけの投票を作り直さない）', async () => {
    isFetched = false
    mount(fakeEditor([poll('b1', 'p1')]))
    await new Promise((r) => setTimeout(r, 10))
    expect(createPoll).not.toHaveBeenCalled()
  })
})

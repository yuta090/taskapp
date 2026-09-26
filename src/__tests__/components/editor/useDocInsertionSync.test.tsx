import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocInsertion } from '@/lib/doc-insertions/logic'

const fetchDocInsertions = vi.fn()
const markDocInsertionApplied = vi.fn()
const markDocInsertionRemoved = vi.fn()
const claimDocInsertion = vi.fn()
const dismissDocInsertion = vi.fn()
vi.mock('@/lib/doc-insertions/api', () => ({
  claimDocInsertion: (...a: unknown[]) => claimDocInsertion(...a),
  dismissDocInsertion: (...a: unknown[]) => dismissDocInsertion(...a),
  fetchDocInsertions: (...a: unknown[]) => fetchDocInsertions(...a),
  markDocInsertionApplied: (...a: unknown[]) => markDocInsertionApplied(...a),
  markDocInsertionRemoved: (...a: unknown[]) => markDocInsertionRemoved(...a),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
const listeners = new Map<string, () => void>()
const sent: string[] = []
vi.mock('@/lib/hooks/useDocVoteSignal', () => ({
  onDocSignal: (topic: string, event: string, cb: () => void) => {
    listeners.set(`${topic}|${event}`, cb)
    return () => listeners.delete(`${topic}|${event}`)
  },
  sendDocSignal: (topic: string, event: string) => sent.push(`${topic}|${event}`),
}))

import { useDocInsertionSync, type InsertionEditorLike } from '@/components/editor/docInsertion/useDocInsertionSync'

const row = (id: string, over: Partial<DocInsertion> = {}): DocInsertion => ({
  id, org_id: 'o', space_id: 's', wiki_page_id: null, meeting_id: 'm1', kind: 'meeting_note', content: '予算が\n合わない',
  anchor: null, status: 'pending', anchor_missed: false, author_id: 'u', author_name: '鈴木 一郎', created_at: '2026-09-26T05:30:00Z',
  ...over,
})

type Blk = { id: string; type: string; props?: Record<string, unknown>; children?: Blk[] }
function fakeEditor(doc: Blk[]) {
  const setMeta = vi.fn()
  const editor: InsertionEditorLike & { document: Blk[] } = {
    document: doc,
    insertBlocks: vi.fn((blocks: Blk[], ref: string) => {
      const i = editor.document.findIndex((b) => b.id === ref)
      editor.document = [...editor.document.slice(0, i + 1), ...blocks, ...editor.document.slice(i + 1)]
    }),
    removeBlocks: vi.fn((ids: string[]) => {
      editor.document = editor.document.filter((b) => !ids.includes(b.id))
    }),
    transact: vi.fn((cb: (tr: { setMeta: typeof setMeta }) => unknown) => cb({ setMeta })),
  }
  return { editor, setMeta }
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  fetchDocInsertions.mockReset()
  markDocInsertionApplied.mockReset().mockResolvedValue(undefined)
  markDocInsertionRemoved.mockReset().mockResolvedValue(undefined)
  claimDocInsertion.mockReset().mockResolvedValue(true)
  dismissDocInsertion.mockReset().mockResolvedValue(undefined)
  listeners.clear()
  sent.length = 0
})

describe('useDocInsertionSync（社内の編集画面が相手先の差し込みを本文に入れる）', () => {
  it('反映待ちを本文の末尾に入れる。書いた人・日時・種類を持たせ、元に戻す履歴には載せない', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1')])
    const { editor, setMeta } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(editor.insertBlocks).toHaveBeenCalled())
    const [blocks, ref, where] = (editor.insertBlocks as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(ref).toBe('b1')
    expect(where).toBe('after')
    expect(blocks[0]).toMatchObject({
      id: 'i1',
      type: 'docInsertion',
      props: { insertionId: 'i1', kind: 'meeting_note', author: '鈴木 一郎', createdAt: '2026-09-26T14:30' },
      content: '予算が\n合わない',
    })
    expect(setMeta).toHaveBeenCalledWith('addToHistory', false)
    // 入れた直後はまだ保存されていないので、反映済みにはしない
    expect(markDocInsertionApplied).not.toHaveBeenCalled()
  })

  it('保存のあと（minutes-saved）に、本文にある分を反映済みにして知らせる', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1')])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(editor.insertBlocks).toHaveBeenCalled())
    await act(async () => {
      listeners.get('meeting-minutes-view:m1|minutes-saved')?.()
    })
    await waitFor(() => expect(markDocInsertionApplied).toHaveBeenCalledWith(expect.anything(), 'i1', false))
    await waitFor(() => expect(sent).toContain('meeting-minutes-view:m1|insertion-changed'))
  })

  it('反映済みにするのを DB が断っても（保存前）画面は壊さない', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1')])
    markDocInsertionApplied.mockRejectedValue({ code: '22023', message: 'not_in_body' })
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }, { id: 'i1', type: 'docInsertion', props: { insertionId: 'i1' } }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(markDocInsertionApplied).toHaveBeenCalled())
    expect(editor.insertBlocks).not.toHaveBeenCalled()
  })

  it('削除依頼は本文から消し、保存のあとに削除済みにする', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1', { status: 'remove_requested' })])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }, { id: 'x9', type: 'docInsertion', props: { insertionId: 'i1' } }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(editor.removeBlocks).toHaveBeenCalledWith(['x9']))
    await act(async () => {
      listeners.get('meeting-minutes-view:m1|minutes-saved')?.()
    })
    await waitFor(() => expect(markDocInsertionRemoved).toHaveBeenCalledWith(expect.anything(), 'i1'))
  })

  it('取り込まない画面（読むだけ・書記でないタブ）では何もしない', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1')])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: false }), { wrapper: wrapper() })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchDocInsertions).not.toHaveBeenCalled()
    expect(editor.insertBlocks).not.toHaveBeenCalled()
  })

  it('相手先が足した・取り下げたの知らせで読み直す', async () => {
    fetchDocInsertions.mockResolvedValue([])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(fetchDocInsertions).toHaveBeenCalledTimes(1))
    await act(async () => {
      listeners.get('meeting-minutes-view:m1|insertion-changed')?.()
    })
    await waitFor(() => expect(fetchDocInsertions).toHaveBeenCalledTimes(2))
  })
})

describe('useDocInsertionSync（1つのタブだけが取り込む・社内が採らなかった・取り消し）', () => {
  it('取り込む権利が取れなかったら本文に入れない（ほかのタブが取り込んでいる）', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1')])
    claimDocInsertion.mockResolvedValue(false)
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(claimDocInsertion).toHaveBeenCalledWith(expect.anything(), 'i1', expect.any(String)))
    await new Promise((r) => setTimeout(r, 20))
    expect(editor.insertBlocks).not.toHaveBeenCalled()
  })

  it('取り込んだ行を社内が保存の前に消したら、保存のあとに「採らなかった」として閉じる（入れ直さない）', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1')])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(editor.insertBlocks).toHaveBeenCalledTimes(1))
    // 社内の人が消した
    editor.document = editor.document.filter((b) => b.id !== 'i1')
    await act(async () => {
      listeners.get('meeting-minutes-view:m1|minutes-saved')?.()
    })
    await waitFor(() => expect(dismissDocInsertion).toHaveBeenCalledWith(expect.anything(), 'i1'))
    expect(editor.insertBlocks).toHaveBeenCalledTimes(1)
  })

  it('取り消されたのに本文にある行は消す', async () => {
    fetchDocInsertions.mockResolvedValue([row('i1', { status: 'withdrawn' })])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }, { id: 'x9', type: 'docInsertion', props: { insertionId: 'i1' } }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() => expect(editor.removeBlocks).toHaveBeenCalledWith(['x9']))
  })

  it('取り消された行も台帳から読む', async () => {
    fetchDocInsertions.mockResolvedValue([])
    const { editor } = fakeEditor([{ id: 'b1', type: 'paragraph' }])
    renderHook(() => useDocInsertionSync({ editor, meetingId: 'm1', enabled: true }), { wrapper: wrapper() })
    await waitFor(() =>
      expect(fetchDocInsertions).toHaveBeenCalledWith(expect.anything(), { meetingId: 'm1' }, ['pending', 'remove_requested', 'withdrawn'])
    )
  })
})

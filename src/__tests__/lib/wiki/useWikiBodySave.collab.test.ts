// @vitest-environment jsdom
/**
 * Wiki 本文の保存（`useWikiBodySave`）の、同時編集中の決まりごと。
 *
 * 議事録（MinutesDocumentView）と同じ形にそろえる:
 *  - 列へ保存するのは書記1人だけ（全員でやると更新時刻の突き合わせで弾き合う）
 *  - 部屋の中の誰かが保存した分は競合ではない（中身は器で合流済み）
 *  - 保存が通ったら、次の書記のために基準を部屋に残す
 *  - 書記を引き継いだら、列を読み直して基準を取り直す
 * あわせて、仕様の確定で末尾にブロックが足されただけなら帯を出さずに取り込む。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import * as Y from 'yjs'
import { useWikiBodySave } from '@/lib/wiki/useWikiBodySave'
import { WikiConflictError } from '@/lib/hooks/useWikiPages'
import { readSavedState, writeSavedState } from '@/lib/collab/scribe'
import { wikiContentHash } from '@/lib/wiki/bodyMerge'
import type { WikiPage } from '@/types/database'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const P = 'page-1'
const block = (id: string, text: string) => ({ id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })
const BODY0 = JSON.stringify([block('a', 'はじめ')])
const BODY1 = JSON.stringify([block('a', 'はじめ'), block('b', '書いた')])

function page(body: string, updatedAt: string): WikiPage {
  return { id: P, body, updated_at: updatedAt } as unknown as WikiPage
}

function setup() {
  const updatePage = vi.fn<(id: string, input: { body?: string }, base?: string) => Promise<{ updatedAt: string | null }>>(
    async () => ({ updatedAt: 't1' })
  )
  const fetchPage = vi.fn(async (): Promise<WikiPage | null> => page(BODY0, 't0'))
  const rendered = renderHook(() => useWikiBodySave({ updatePage, fetchPage }))
  const doc = new Y.Doc()
  const meta = doc.getMap('meta')
  act(() => rendered.result.current.setBaseline({ updated_at: 't0', body: BODY0 }, { content: true }))
  return { ...rendered, updatePage, fetchPage, meta }
}

/** 自動保存の待ち（1.5秒）を進めて、保存の往復を終わらせる */
async function flushTimers() {
  await act(async () => {
    vi.advanceTimersByTime(1600)
  })
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('同時編集中の保存', () => {
  it('書記でない人は、打っても列へ保存しない', async () => {
    const { result, updatePage, meta } = setup()
    act(() => result.current.setCollab({ active: true, isScribe: false, meta }))
    act(() => result.current.handleChange(P, BODY1))
    await flushTimers()
    expect(updatePage).not.toHaveBeenCalled()
    expect(result.current.saveStatus).toBe('idle')
  })

  it('書記は保存し、通ったら基準（更新時刻と本文の合言葉）を部屋に残す', async () => {
    const { result, updatePage, meta } = setup()
    act(() => result.current.setCollab({ active: true, isScribe: true, meta }))
    act(() => result.current.handleChange(P, BODY1))
    await flushTimers()
    expect(updatePage).toHaveBeenCalledWith(P, { body: BODY1 }, 't0')
    expect(readSavedState(meta)).toEqual({ savedAt: 't1', savedHash: wikiContentHash(BODY1) })
  })

  it('部屋の誰かが保存した分で弾かれたときは、競合にせず基準を差し替えて保存し直す', async () => {
    const { result, updatePage, fetchPage, meta } = setup()
    // 前の書記が BODY1 を保存して t1 になった（自分の基準は t0 のまま）
    writeSavedState(meta, { savedAt: 't1', savedHash: wikiContentHash(BODY1) })
    fetchPage.mockResolvedValue(page(BODY1, 't1'))
    updatePage
      .mockRejectedValueOnce(new WikiConflictError())
      .mockResolvedValueOnce({ updatedAt: 't2' })
    act(() => result.current.setCollab({ active: true, isScribe: true, meta }))
    const BODY2 = JSON.stringify([block('a', 'はじめ'), block('b', '書いた'), block('c', 'もっと')])
    act(() => result.current.handleChange(P, BODY2))
    await flushTimers()
    expect(result.current.conflict).toBe(false)
    expect(updatePage).toHaveBeenLastCalledWith(P, { body: BODY2 }, 't1')
  })

  it('書記を引き継いだら列を読み直し、器の中身が列と違えば1回保存する', async () => {
    const { result, updatePage, fetchPage, meta } = setup()
    writeSavedState(meta, { savedAt: 't1', savedHash: wikiContentHash(BODY0) })
    fetchPage.mockResolvedValue(page(BODY0, 't1'))
    act(() => result.current.setCollab({ active: true, isScribe: false, meta }))
    // 書記でないあいだに打った分（器では全員に届いている）
    act(() => result.current.handleChange(P, BODY1))
    act(() => result.current.setCollab({ active: true, isScribe: true, meta }))
    await act(async () => {
      await result.current.takeOverAsScribe(P)
    })
    await flushTimers()
    expect(updatePage).toHaveBeenCalledWith(P, { body: BODY1 }, 't1')
  })

  it('まだ誰も保存していない部屋で書記になったときは、読み直さない（自分が最初の1人）', async () => {
    const { result, fetchPage, meta } = setup()
    act(() => result.current.setCollab({ active: true, isScribe: true, meta }))
    await act(async () => {
      await result.current.takeOverAsScribe(P)
    })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('同時編集中の「最新を読み込む」は、エディタを作り直さずに中身を差し替える（部屋の全員に届く）', async () => {
    const { result, fetchPage, meta } = setup()
    const replaceContent = vi.fn(() => true)
    act(() => {
      result.current.setCollab({ active: true, isScribe: true, meta })
      result.current.registerEditorApi({ replaceContent, appendBlocks: vi.fn(() => 'applied' as const) })
    })
    fetchPage.mockResolvedValue(page(BODY1, 't5'))
    const before = result.current.editorReloadToken
    await act(async () => {
      await result.current.reloadLatest(P)
    })
    expect(replaceContent).toHaveBeenCalledWith(BODY1)
    expect(result.current.editorReloadToken).toBe(before)
  })
})

describe('仕様の確定で末尾にブロックが足されたとき', () => {
  it('帯を出さずにエディタの末尾へ差し込み、基準をサーバーに合わせる', async () => {
    const { result, updatePage, fetchPage } = setup()
    const appendBlocks = vi.fn(() => 'applied' as const)
    act(() => result.current.registerEditorApi({ replaceContent: vi.fn(() => true), appendBlocks }))
    const tail = { type: 'paragraph', content: [{ type: 'text', text: '確定しました', styles: {} }] }
    // 自分が打つあいだに、確定で BODY0 の末尾に1ブロック足された
    fetchPage.mockResolvedValue(page(JSON.stringify([...JSON.parse(BODY0), tail]), 't9'))
    updatePage.mockRejectedValueOnce(new WikiConflictError())
    act(() => result.current.handleChange(P, BODY1))
    await flushTimers()
    expect(appendBlocks).toHaveBeenCalledWith([tail])
    expect(result.current.conflict).toBe(false)
    expect(result.current.getBaseUpdatedAt()).toBe('t9')
  })

  it('途中まで書き換えられていたら、これまでどおり競合の帯を出す', async () => {
    const { result, updatePage, fetchPage } = setup()
    const appendBlocks = vi.fn(() => 'applied' as const)
    act(() => result.current.registerEditorApi({ replaceContent: vi.fn(() => true), appendBlocks }))
    fetchPage.mockResolvedValue(page(JSON.stringify([block('a', '書き換えた')]), 't9'))
    updatePage.mockRejectedValueOnce(new WikiConflictError())
    act(() => result.current.handleChange(P, BODY1))
    await flushTimers()
    expect(appendBlocks).not.toHaveBeenCalled()
    expect(result.current.conflict).toBe(true)
  })
})

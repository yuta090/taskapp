/**
 * WikiEditor を同時編集につなぐ部分。
 *
 * 議事録（MinutesEditor）と同じ約束:
 *  - 同時編集では `initialContent` を渡さない（BlockNote が器の中身で置き換えて捨てるため。
 *    本文は種まきで器へ入れる）
 *  - 種まき・本文の差し替え・末尾への追記の差し込み口を、呼び出し側へ貸す
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { WikiEditor, type WikiEditorHandle } from '@/components/wiki/WikiEditor'

let capturedOptions: Record<string, unknown> | undefined
const mockReplaceBlocks = vi.fn()
const mockInsertBlocks = vi.fn()
const mockEditor = {
  document: [{ id: 'first' }, { id: 'last' }],
  isEditable: true,
  prosemirrorView: { composing: false },
  replaceBlocks: mockReplaceBlocks,
  insertBlocks: mockInsertBlocks,
  focus: vi.fn(),
  getTextCursorPosition: vi.fn(() => ({ block: { id: 'first' } })),
  pmSchema: {},
}

vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: (options: Record<string, unknown>) => {
      capturedOptions = options
      return mockEditor
    },
    getDefaultReactSlashMenuItems: () => [],
    SuggestionMenuController: () => null,
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ children }: { children?: React.ReactNode }) => <div data-testid="blocknote-view">{children}</div>,
}))

const BODY = JSON.stringify([{ id: 'a', type: 'paragraph', content: [], children: [] }])

function collaboration() {
  const doc = new Y.Doc()
  return { fragment: doc.getXmlFragment('minutes'), awareness: new Awareness(doc), userName: '自分', colorIndex: 0 }
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedOptions = undefined
  mockEditor.isEditable = true
  mockEditor.prosemirrorView.composing = false
})

describe('WikiEditor の同時編集', () => {
  it('同時編集のときは initialContent を渡さず、器と在席を BlockNote に渡す', () => {
    const collab = collaboration()
    render(<WikiEditor initialContent={BODY} collaboration={collab} />)
    expect(capturedOptions).not.toHaveProperty('initialContent')
    const passed = capturedOptions!.collaboration as { fragment: unknown; provider: { awareness: unknown } }
    expect(passed.fragment).toBe(collab.fragment)
    expect(passed.provider.awareness).toBe(collab.awareness)
  })

  it('同時編集でなければ、これまでどおり initialContent で本文を載せる', () => {
    render(<WikiEditor initialContent={BODY} />)
    expect(capturedOptions!.initialContent).toEqual(JSON.parse(BODY))
    expect(capturedOptions).not.toHaveProperty('collaboration')
  })

  it('差し込み口を貸し、外れるときは null を渡す', () => {
    const registerApi = vi.fn()
    const { unmount } = render(<WikiEditor initialContent={BODY} registerApi={registerApi} />)
    const api = registerApi.mock.calls.at(-1)?.[0] as WikiEditorHandle
    expect(typeof api.seedCollabDoc).toBe('function')
    expect(typeof api.replaceContent).toBe('function')
    expect(typeof api.appendBlocks).toBe('function')
    unmount()
    expect(registerApi).toHaveBeenLastCalledWith(null)
  })

  it('replaceContent は本文を丸ごと差し替える。空なら段落を1つ置く。読めなければ false', () => {
    const registerApi = vi.fn()
    render(<WikiEditor initialContent={BODY} registerApi={registerApi} />)
    const api = registerApi.mock.calls.at(-1)?.[0] as WikiEditorHandle
    expect(api.replaceContent(BODY)).toBe(true)
    expect(mockReplaceBlocks).toHaveBeenLastCalledWith(mockEditor.document, JSON.parse(BODY))
    expect(api.replaceContent(null)).toBe(true)
    expect(mockReplaceBlocks).toHaveBeenLastCalledWith(mockEditor.document, [{ type: 'paragraph' }])
    expect(api.replaceContent('{壊れている')).toBe(false)
  })

  it('appendBlocks は最後のブロックの後ろに足す。読み取り専用・変換中は busy', () => {
    const registerApi = vi.fn()
    render(<WikiEditor initialContent={BODY} registerApi={registerApi} />)
    const api = registerApi.mock.calls.at(-1)?.[0] as WikiEditorHandle
    const tail = [{ type: 'paragraph' }]
    expect(api.appendBlocks(tail)).toBe('applied')
    expect(mockInsertBlocks).toHaveBeenCalledWith(tail, { id: 'last' }, 'after')

    mockEditor.prosemirrorView.composing = true
    expect(api.appendBlocks(tail)).toBe('busy')
    mockEditor.prosemirrorView.composing = false
    mockEditor.isEditable = false
    expect(api.appendBlocks(tail)).toBe('busy')
  })
})

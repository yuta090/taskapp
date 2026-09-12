import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MinutesEditor, type MinutesEditorApi } from '@/components/meeting/MinutesEditor'

// AI秘書の末尾追記との自動合流(MinutesDocumentView)が使う差し込み口。
// 本体を作り直さず、生きているエディタの末尾に本物の BlockNote トランザクションを
// 起こすことで、いつもの onChange→自動保存がそのまま走ることを確かめる。
//
// 'busy'（一時的。少し待てばできる）と 'failed'（恒久的）を区別する:
// - 読み取り専用（タスク化中など）・日本語の変換(IME)中は 'busy'
// - Markdown の解析・ブロックの挿入そのものが失敗したら 'failed'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const mockInsertInlineContent = vi.fn()
const mockInsertBlocks = vi.fn()
// 「今の文書」の最後のブロック。insertBlocks がこれを referenceBlock として
// 呼ばれることを検査する。
const mockLastBlock = { id: 'block-last', type: 'paragraph', content: [] }
const mockDocument: unknown[] = [{ id: 'block-first', type: 'paragraph', content: [] }, mockLastBlock]
// 日本語などの変換(IME)の途中かどうか。テストごとに書き換えて appendMarkdown の
// composing 判定を検査する（getter にして、マウント後の書き換えも反映させる）。
let mockComposing = false

const mockUseCreateBlockNote = vi.fn((_opts: unknown) => ({
  document: mockDocument,
  insertInlineContent: mockInsertInlineContent,
  insertBlocks: mockInsertBlocks,
  get prosemirrorView() {
    return { composing: mockComposing }
  },
}))

vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: (opts: unknown) => mockUseCreateBlockNote(opts),
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view" />,
}))

vi.mock('@/components/wiki/WikiFileLinkPicker', () => ({
  WikiFileLinkPicker: () => <div data-testid="wiki-file-link-picker" />,
}))

vi.mock('@/components/meeting/MinutesWikiLinkPicker', () => ({
  MinutesWikiLinkPicker: () => <div data-testid="minutes-wiki-link-picker" />,
}))

function setup(props: { editable?: boolean; minutesMd?: string } = {}) {
  let capturedApi: MinutesEditorApi | null = null
  const registerApi = (api: MinutesEditorApi | null) => {
    capturedApi = api
  }
  const utils = render(
    <MinutesEditor
      minutesMd={props.minutesMd ?? '# 定例MTG\n\n決まったこと'}
      editable={props.editable ?? true}
      orgId={ORG_ID}
      spaceId={SPACE_ID}
      registerApi={registerApi}
    />
  )
  return { ...utils, getApi: () => capturedApi }
}

describe('MinutesEditor appendMarkdown（末尾差し込み口）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComposing = false
  })

  it('マウントすると registerApi へ appendMarkdown を持つ api を渡す', () => {
    const { getApi } = setup()
    expect(getApi()).not.toBeNull()
    expect(typeof getApi()!.appendMarkdown).toBe('function')
  })

  it('アンマウントすると registerApi(null) を呼ぶ', () => {
    let lastCall: MinutesEditorApi | null | undefined
    const registerApi = (api: MinutesEditorApi | null) => {
      lastCall = api
    }
    const { unmount } = render(
      <MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} registerApi={registerApi} />
    )
    expect(lastCall).not.toBeNull()
    unmount()
    expect(lastCall).toBeNull()
  })

  it('appendMarkdown: 今の文書の最後のブロックの後ろに insertBlocks を呼び、"applied" を返す', () => {
    const { getApi } = setup()
    let result: string = ''
    act(() => {
      result = getApi()!.appendMarkdown('AI秘書が追記した分')
    })

    expect(result).toBe('applied')
    expect(mockInsertBlocks).toHaveBeenCalledTimes(1)
    const [blocksArg, referenceBlockArg, placementArg] = mockInsertBlocks.mock.calls[0]
    expect(Array.isArray(blocksArg)).toBe(true)
    expect(blocksArg.length).toBeGreaterThan(0)
    expect(referenceBlockArg).toBe(mockLastBlock)
    expect(placementArg).toBe('after')
  })

  it('読み取り専用(editable=false)なら何もせず"busy"を返す（一時的：タスク化中などは待てば戻る）', () => {
    const { getApi } = setup({ editable: false })
    let result: string = ''
    act(() => {
      result = getApi()!.appendMarkdown('追記')
    })
    expect(result).toBe('busy')
    expect(mockInsertBlocks).not.toHaveBeenCalled()
  })

  it('日本語などの変換(IME)の途中は差し込まず"busy"を返す。変換が終われば取り込まれる', () => {
    mockComposing = true
    const { getApi } = setup()
    let result: string = ''
    act(() => {
      result = getApi()!.appendMarkdown('追記')
    })
    expect(result).toBe('busy')
    expect(mockInsertBlocks).not.toHaveBeenCalled()

    // 変換が終わった
    mockComposing = false
    act(() => {
      result = getApi()!.appendMarkdown('追記')
    })
    expect(result).toBe('applied')
    expect(mockInsertBlocks).toHaveBeenCalledTimes(1)
  })

  it('insertBlocks が例外を投げたら"failed"を返す（文書を壊さない・恒久的な失敗）', () => {
    mockInsertBlocks.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const { getApi } = setup()
    let result: string = ''
    act(() => {
      result = getApi()!.appendMarkdown('追記')
    })
    expect(result).toBe('failed')
  })

})

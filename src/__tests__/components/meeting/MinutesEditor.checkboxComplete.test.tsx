import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { MinutesEditor } from '@/components/meeting/MinutesEditor'
import { MinutesCompleteError } from '@/lib/hooks/useMinutesTaskActions'

/**
 * 議事録の行にチェックを入れたとき、そのタスクを完了にする流れ。
 *
 * 完了できないとき、DB のトリガーは**英語で**返す（`Cannot complete task: ...`）。
 * それがそのまま画面に出ていたので、日本語と「次にすること」に置き換えた。
 */

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'
const TASK_ID = '11111111-1111-1111-1111-111111111111'

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const mockUpdateBlock = vi.fn()
const mockDocument: unknown[] = []
const mockEditor = {
  document: mockDocument,
  insertInlineContent: vi.fn(),
  insertBlocks: vi.fn(),
  getTextCursorPosition: () => ({ block: { id: 'x' } }),
  updateBlock: mockUpdateBlock,
  forEachBlock: (fn: (block: unknown) => boolean) => {
    for (const block of mockDocument) if (!fn(block)) return
  },
  focus: vi.fn(),
}

let capturedOnChange: (() => void) | undefined
vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: () => mockEditor,
    getDefaultReactSlashMenuItems: () => [],
    SuggestionMenuController: () => null,
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ onChange }: { onChange?: () => void }) => {
    capturedOnChange = onChange
    return <div data-testid="blocknote-view" />
  },
}))

vi.mock('@/components/meeting/MinutesTaskLinePanel', () => ({ MinutesTaskLinePanel: () => null }))

/** チェックの付いた「タスク作成済み」の行1つ、という文書にする */
function setCheckedDocument() {
  mockDocument.splice(0, mockDocument.length, {
    type: 'checkListItem',
    props: { checked: true },
    content: [
      { type: 'text', text: 'やること', styles: {} },
      { type: 'taskMarker', props: { taskId: TASK_ID } },
    ],
  })
}

function setup(run: (taskId: string, action: 'complete' | 'decide') => Promise<void>) {
  const resolve = vi.fn().mockResolvedValue(null)
  render(
    <MinutesEditor
      minutesMd={`- [ ] やること <!--task:${TASK_ID}-->`}
      editable
      orgId={ORG_ID}
      spaceId={SPACE_ID}
      onResolveTask={{ resolve, run }}
    />
  )
  setCheckedDocument()
}

describe('議事録の行にチェックを入れたとき', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnChange = undefined
  })

  it('ふつうのタスクなら完了にする', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    setup(run)
    act(() => capturedOnChange!())
    await waitFor(() => expect(run).toHaveBeenCalledWith(TASK_ID, 'complete'))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('決まっていない決定事項のタスクでは、英語のままのエラーを出さない', async () => {
    const run = vi.fn().mockRejectedValue(new MinutesCompleteError('spec_undecided'))
    setup(run)
    act(() => capturedOnChange!())
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const message = toastError.mock.calls[0][0] as string
    expect(message).not.toContain('Cannot complete')
    expect(message).toContain('決定事項のタスク')
  })

  it('決まっていないときは「決定にして完了にする」を出し、押すと2手まとめて進む', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new MinutesCompleteError('spec_undecided'))
      .mockResolvedValue(undefined)
    setup(run)
    act(() => capturedOnChange!())
    await waitFor(() => expect(toastError).toHaveBeenCalled())

    const options = toastError.mock.calls[0][1] as { action: { label: string; onClick: () => void } }
    expect(options.action.label).toBe('決定にして完了にする')
    await act(async () => {
      options.action.onClick()
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(run).toHaveBeenNthCalledWith(2, TASK_ID, 'decide')
    expect(run).toHaveBeenNthCalledWith(3, TASK_ID, 'complete')
  })

  it('完了にできなかったらチェックを戻す（完了したと誤解しないように）', async () => {
    const run = vi.fn().mockRejectedValue(new MinutesCompleteError('review_pending'))
    setup(run)
    act(() => capturedOnChange!())
    await waitFor(() => expect(mockUpdateBlock).toHaveBeenCalled())
    const [, update] = mockUpdateBlock.mock.calls[0]
    expect((update as { props: { checked: boolean } }).props.checked).toBe(false)
  })
})

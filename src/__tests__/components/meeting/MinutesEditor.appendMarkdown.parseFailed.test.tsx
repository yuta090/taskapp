import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MinutesEditor, type MinutesEditorApi } from '@/components/meeting/MinutesEditor'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

// 恒久的な 'failed'（待っても直らない）: 議事録の形式が壊れていて、初期表示の
// parseMinutesMarkdown 自体が例外を投げ、読み取り専用に倒している最中。
// MinutesEditor.parseFailsafe.test.tsx と同じ手口でモジュールを丸ごとモックする。

vi.mock('@/lib/minutes/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/minutes/markdown')>()
  return {
    ...actual,
    parseMinutesMarkdown: () => {
      throw new Error('boom')
    },
  }
})

vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: () => ({
      document: [],
      insertInlineContent: vi.fn(),
      insertBlocks: vi.fn(),
    }),
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view" />,
}))

describe('MinutesEditor appendMarkdown: 恒久的な失敗(parseFailedRef)', () => {
  it('議事録の形式が壊れて読み取り専用に倒れている場合は editable=true でも"failed"を返す', () => {
    let capturedApi: MinutesEditorApi | null = null
    render(
      <MinutesEditor
        minutesMd="# 壊れる本文"
        editable
        orgId={ORG_ID}
        spaceId={SPACE_ID}
        registerApi={(api) => {
          capturedApi = api
        }}
      />
    )

    expect(capturedApi).not.toBeNull()
    // parseMinutesMarkdown は常に例外を投げるモックなので、appendMarkdown の中の
    // 追記の解析も失敗する。'busy'（一時的）ではなく'failed'（恒久的）である必要がある。
    expect(capturedApi!.appendMarkdown('追記')).toBe('failed')
  })
})

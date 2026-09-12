import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MinutesEditor } from '@/components/meeting/MinutesEditor'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

// 例外が出ないはずのところへの念のための守り。parseMinutesMarkdown が万一例外を投げても
// 画面を壊さず、読み取り専用にフォールバックする（本文全体を段落の生テキストとして出す）。

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
    }),
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view" />,
}))

describe('MinutesEditor parseMinutesMarkdown 失敗時のフェイルセーフ', () => {
  it('例外を投げずにレンダーし、編集可能でも差し込みツールバーを出さない（読み取り専用に倒す）', () => {
    expect(() =>
      render(<MinutesEditor minutesMd="# 壊れる本文" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    ).not.toThrow()

    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
    expect(screen.queryByText('ファイルへのリンク')).not.toBeInTheDocument()
    expect(screen.queryByText('Wikiページへのリンク')).not.toBeInTheDocument()
  })
})

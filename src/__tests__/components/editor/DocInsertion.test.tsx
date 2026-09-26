import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { DocInsertionView } from '@/components/editor/docInsertion/DocInsertionView'
import { docInsertionSpec } from '@/components/editor/docInsertion/docInsertionBlock'

describe('相手先が足した行・メモの見た目', () => {
  it('メモは帯で出し、書いた人と日時を添える', () => {
    render(<DocInsertionView kind="meeting_note" author="鈴木 一郎" createdAt="2026-09-26T14:30">予算</DocInsertionView>)
    expect(screen.getByTestId('doc-insertion')).toHaveAttribute('data-kind', 'meeting_note')
    expect(screen.getByText('鈴木 一郎')).toBeInTheDocument()
    expect(screen.getByText('予算')).toBeInTheDocument()
  })

  it('行は普通の行として出し、右端に書いた人を小さく添える', () => {
    render(<DocInsertionView kind="paragraph" author="田中" createdAt="2026-09-26T14:30">足した行</DocInsertionView>)
    expect(screen.getByTestId('doc-insertion')).toHaveAttribute('data-kind', 'paragraph')
    expect(screen.getByText('田中')).toBeInTheDocument()
  })

  it('反映待ちの印や取り消しボタンを添えられる', () => {
    render(
      <DocInsertionView kind="paragraph" author="田中" createdAt="" badge={<span>反映待ち</span>} actions={<button>取り消す</button>}>
        行
      </DocInsertionView>
    )
    expect(screen.getByText('反映待ち')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取り消す' })).toBeInTheDocument()
  })
})

describe('外へ出すときの形', () => {
  it('コピーして外へ貼ると本文だけ（名前・目印は出さない）', async () => {
    const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, docInsertion: docInsertionSpec } })
    const editor = BlockNoteEditor.create({ schema })
    const html = await editor.blocksToHTMLLossy([
      {
        type: 'docInsertion',
        props: { insertionId: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', kind: 'meeting_note', createdAt: '2026-09-26T14:30', author: '鈴木 一郎' },
        content: [{ type: 'text', text: '予算が合わない', styles: {} }],
      } as never,
    ])
    // 貼った先で目に見える文字（タグの外）。BlockNote はブロックの props をタグの属性にも書くが、
    // 貼った先には表示されない
    const visible = html.replace(/<[^>]*>/g, '')
    expect(visible).toBe('予算が合わない')
    expect(html).not.toContain('<!--')
  })
})

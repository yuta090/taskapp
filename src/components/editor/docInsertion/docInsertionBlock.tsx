'use client'

import { createReactBlockSpec } from '@blocknote/react'
import { DOC_INSERTION_TYPE, type DocInsertionKind } from '@/lib/doc-insertions/logic'
import { DocInsertionView } from './DocInsertionView'

/**
 * 相手先が足した行・メモのブロック（DOC_VOTE_SPEC §5.1）。本文に入れるのは社内の編集画面だけで、
 * 「/」メニューには出さない。議事録の Markdown では `<!--ins:番号 種類 日時 名前-->本文`（markdown.ts と対）。
 * 社内は中身をふつうに直したり消したりしてよい（本文が正、台帳は記録）。
 */
export const docInsertionSpec = createReactBlockSpec(
  {
    type: DOC_INSERTION_TYPE,
    propSchema: {
      insertionId: { default: '' },
      kind: { default: 'paragraph' as DocInsertionKind, values: ['paragraph', 'meeting_note'] as const },
      createdAt: { default: '' },
      author: { default: '' },
    },
    content: 'inline',
  } as const,
  {
    render: (props) => (
      <DocInsertionView
        kind={props.block.props.kind as DocInsertionKind}
        author={props.block.props.author}
        createdAt={props.block.props.createdAt}
        contentRef={props.contentRef}
      />
    ),
    // コピーして外へ貼ったときは本文だけ（名前・番号を外へ出さない）
    toExternalHTML: (props) => <p ref={props.contentRef} />,
  }
)()

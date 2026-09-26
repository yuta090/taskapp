'use client'

import { createReactBlockSpec } from '@blocknote/react'
import { DOC_POLL_TYPE } from '@/lib/doc-polls/logic'
import type { DocPollReasonRequired } from '@/lib/doc-polls/types'
import { DocPollBlock } from './DocPollContext'

// 中身はエディタに依らないファイルに置いてある（ポータルがエディタを読み込まずに使うため）
export { DocPollContext, DocPollBlock, type DocPollContextValue } from './DocPollContext'

/**
 * 投票ブロック。本文（Wiki の JSON）には投票の番号と理由必須の設定だけを持ち、票は DB に置く
 * （DOC_VOTE_SPEC §3）。議題は普通の文字（inline）で、空でもよい。
 */
export const docPollSpec = createReactBlockSpec(
  {
    type: DOC_POLL_TYPE,
    propSchema: {
      pollId: { default: '' },
      reasonRequired: { default: 'none' as DocPollReasonRequired, values: ['none', 'ng_hold'] as const },
    },
    content: 'inline',
  } as const,
  {
    render: (props) => (
      <DocPollBlock
        pollId={props.block.props.pollId}
        reasonRequired={props.block.props.reasonRequired as DocPollReasonRequired}
        contentRef={props.contentRef}
      />
    ),
    // コピーして Slack やメールに貼ったとき（外へ出す HTML）の形。印と議題だけを出す。
    // 画面の形のまま出すと、押した人の名前やメモまで外へ付いていく（DOC_VOTE_SPEC §8）
    toExternalHTML: (props) => (
      <p>
        <span>{props.block.props.reasonRequired === 'ng_hold' ? '投票（理由必須）: ' : '投票: '}</span>
        <span ref={props.contentRef} />
      </p>
    ),
  }
)() // createReactBlockSpec が返すのは「作る関数」。1回呼んで仕様そのものにする

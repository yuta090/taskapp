'use client'

import { createReactBlockSpec } from '@blocknote/react'
import { createExtension, defaultBlockSpecs } from '@blocknote/core'
import { MEETING_NOTE_TYPE, TOGGLE_TYPE } from '@/lib/minutes/markdown'

/**
 * 議事録だけで使うブロックの定義。`MinutesEditor` から切り出してあるのは、
 * 画面（next/navigation・トースト）を持ち込まずにテストから直接確かめられるようにするため。
 *
 * どちらも `markdown.ts` の書き方と対になっている。片方だけ変えると、入れたものが
 * 保存で消える（この画面は Markdown が正本）。
 */

/**
 * 「会議メモ」ブロックの見た目。会議中にその場で足した補足だと、あとから読んだときに
 * ひと目で分かるよう、背景に色を付けて左に線を引く。
 *
 * 色にアンバー/オレンジは使わない（この製品では「相手先に見える」印の色として
 * 予約している）。文字色は指定しない（背景のトークンが明暗どちらでも切り替わり、
 * 本文の色そのままで読める）。
 */
export function MeetingNoteBlock({ contentRef }: { contentRef: (node: HTMLElement | null) => void }) {
  return (
    <div
      data-testid="minutes-meeting-note"
      className="w-full rounded border-l-4 border-blue-200 bg-blue-50 py-1 pl-3 pr-2"
      ref={contentRef}
    />
  )
}

/**
 * 会議メモ。Markdown では行頭の `<!--note-->` で表す（`markdown.ts` 側と対）。
 * 見た目だけのブロックなので props は持たせない（持たせても Markdown に残せない）。
 */
export const meetingNoteSpec = createReactBlockSpec(
  {
    type: MEETING_NOTE_TYPE,
    propSchema: {},
    content: 'inline',
  } as const,
  {
    render: (props) => <MeetingNoteBlock contentRef={props.contentRef} />,
  }
)() // createReactBlockSpec が返すのは「作る関数」。1回呼んで仕様そのものにする

/**
 * 折りたたみ。BlockNote の既定の折りたたみをそのまま使い、**入力ルールだけ足す**。
 *
 * 既定では `>` ＋スペースは引用ブロックに変わるが、議事録に引用ブロックは無い
 * （Markdown の往復ができないので入れていない）。そのため今までは `>` を打っても
 * ただの文字として残っていた。Notion と同じ感覚で使えるよう、`>` ＋スペースを
 * 折りたたみに割り当てる。
 */
export const toggleListItemSpec = {
  ...defaultBlockSpecs.toggleListItem,
  extensions: [
    ...(defaultBlockSpecs.toggleListItem.extensions ?? []),
    createExtension({
      key: 'minutes-toggle-from-angle-bracket',
      inputRules: [
        {
          find: /^>\s$/,
          replace: () => ({ type: TOGGLE_TYPE, props: {} }),
        },
      ],
    }),
  ],
}

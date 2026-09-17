'use client'

import { createReactBlockSpec } from '@blocknote/react'
import { createExtension, defaultBlockSpecs } from '@blocknote/core'
import { MEETING_NOTE_TYPE, TOGGLE_TYPE } from '@/lib/minutes/markdown'
import { formatNoteStampLabel, normalizeNoteAuthor } from '@/lib/minutes/noteStamp'

/**
 * 議事録で使うブロックの定義（会議メモは Wiki でも「メモ」として使う）。`MinutesEditor` から
 * 切り出してあるのは、画面（next/navigation・トースト）を持ち込まずにテストから直接
 * 確かめられるようにするため。
 *
 * どちらも `markdown.ts` の書き方と対になっている。片方だけ変えると、入れたものが
 * 保存で消える（議事録は Markdown が正本）。
 */

/**
 * 「会議メモ」ブロックの見た目。会議中にその場で足した補足だと、あとから読んだときに
 * ひと目で分かるよう、背景に色を付けて左に線を引く。右端に書いた人と日時を小さく添える。
 *
 * 色にアンバー/オレンジは使わない（この製品では「相手先に見える」印の色として
 * 予約している）。文字色は指定しない（背景のトークンが明暗どちらでも切り替わり、
 * 本文の色そのままで読める）。
 */
export function MeetingNoteBlock({
  createdAt,
  author,
  contentRef,
}: {
  createdAt?: string
  author?: string
  contentRef: (node: HTMLElement | null) => void
}) {
  const label = formatNoteStampLabel(createdAt)
  const authorName = normalizeNoteAuthor(author)
  return (
    <div
      data-testid="minutes-meeting-note"
      // 背景は blue-100。blue-50 はダークで #101F35 になり、面（#191E27）と明度差がほとんど無く
      // 帯が沈んで分かりづらかった（ユーザー申告・2026-09-17）。左の縦線は明るい水色のまま残す
      className="flex w-full items-start gap-2 rounded border-l-4 border-blue-200 bg-blue-100 py-1 pl-3 pr-2"
    >
      {/* 文字を持てるのはこの中だけ。書いた人と日時は外に置き、打てないようにする */}
      <div className="min-w-0 flex-1" ref={contentRef} />
      {authorName && (
        <span
          contentEditable={false}
          data-testid="minutes-meeting-note-author"
          title={authorName}
          className="max-w-[10rem] shrink-0 select-none truncate pt-0.5 text-[10px] text-gray-500"
        >
          {authorName}
        </span>
      )}
      {label && (
        <span
          contentEditable={false}
          data-testid="minutes-meeting-note-time"
          className="shrink-0 select-none pt-0.5 text-[10px] text-gray-400"
        >
          {label}
        </span>
      )}
    </div>
  )
}

/**
 * 会議メモ。Markdown では行頭の `<!--note-->` で表す（`markdown.ts` 側と対）。
 * 書いた日時と名前を持つときは `<!--note:2026-09-15T14:30 高橋 優太-->` になる。
 * Wiki（本文は BlockNote の JSON）では props の createdAt / author にそのまま入る。
 */
export const meetingNoteSpec = createReactBlockSpec(
  {
    type: MEETING_NOTE_TYPE,
    propSchema: { createdAt: { default: '' }, author: { default: '' } },
    content: 'inline',
  } as const,
  {
    render: (props) => (
      <MeetingNoteBlock
        createdAt={props.block.props.createdAt}
        author={props.block.props.author}
        contentRef={props.contentRef}
      />
    ),
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

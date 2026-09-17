'use client'

import { useEffect, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { createExtension, defaultBlockSpecs } from '@blocknote/core'
import { MEETING_NOTE_TYPE, TOC_TYPE, TOGGLE_TYPE } from '@/lib/minutes/markdown'
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

/** 目次の1行。`id` は BlockNote のブロックID（画面では `data-id` に出る）。 */
export type TocItem = { id: string; level: number; text: string }

/**
 * 目次が要るのはブロックの一覧と変更の通知だけ。エディタの型をまるごと持ち込むと
 * テストから呼べなくなるので、使う分だけに絞る。
 */
export type BlockNoteEditorLike = {
  document: Array<{ id: string; type: string; props?: Record<string, unknown>; content?: unknown }>
  onChange?: (cb: () => void) => (() => void) | undefined
}

/** 見出しの中身から字だけを取り出す（リンクの中の字も拾う）。 */
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return ''
      const node = c as { type?: string; text?: string; content?: unknown }
      if (typeof node.text === 'string') return node.text
      if (node.type === 'link') return inlineText(node.content)
      return ''
    })
    .join('')
}

/** 本文から見出しだけを拾う。文字を持たない見出しは出さない（押しても意味が無い）。 */
export function collectHeadings(editor: BlockNoteEditorLike): TocItem[] {
  const out: TocItem[] = []
  for (const b of editor.document ?? []) {
    if (b.type !== 'heading') continue
    const text = inlineText(b.content).trim()
    if (!text) continue
    const level = Math.min(Math.max(Number(b.props?.level) || 1, 1), 6)
    out.push({ id: b.id, level, text })
  }
  return out
}

/**
 * 目次。**中身を持たず、開くたびにその時点の見出しから引き直す**ので、見出しを直しても
 * 目次が古くならない（更新ボタンは要らない）。Markdown では `<!--toc-->` の1行で表す
 * （`markdown.ts` 側と対）。
 *
 * 押すとその見出しまで画面が動く。BlockNote は各ブロックの入れ物に `data-id` を出すので、
 * それを目印に探す（見出しに id を振る必要が無い）。
 */
export function TableOfContentsBlock({ editor }: { editor: BlockNoteEditorLike }) {
  // 最初の1回は描くときに拾う（効果の中で state を触らないため）
  const [items, setItems] = useState<TocItem[]>(() => collectHeadings(editor))

  // 以後は中身が変わるたびに引き直す
  useEffect(() => {
    return editor.onChange?.(() => setItems(collectHeadings(editor)))
  }, [editor])

  const jump = (id: string) => {
    document
      .querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      contentEditable={false}
      data-testid="doc-toc"
      // 面をわずかに落として「本文ではない」ことを示す。色はトークンで置き、明暗どちらでも
      // 読めるようにする（アンバー/オレンジは「相手先に見える」印の色なので使わない）
      className="my-2 w-full select-none rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <div className="mb-1 text-[10px] font-medium tracking-wide text-gray-500 dark:text-gray-400">
        目次
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500">見出しがまだありません</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id} style={{ paddingLeft: `${(it.level - 1) * 12}px` }}>
              <button
                type="button"
                onClick={() => jump(it.id)}
                data-testid="doc-toc-item"
                // 本文より1段小さく。行の高さを詰めて、20行あっても画面を圧迫しない
                className="w-full truncate text-left text-xs leading-5 text-gray-600 hover:text-blue-600 hover:underline dark:text-gray-300 dark:hover:text-blue-400"
              >
                {it.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 目次。Markdown では `<!--toc-->` の1行で表す（`markdown.ts` 側と対）。 */
export const tableOfContentsSpec = createReactBlockSpec(
  {
    type: TOC_TYPE,
    propSchema: {},
    content: 'none',
  } as const,
  {
    render: (props) => <TableOfContentsBlock editor={props.editor as unknown as BlockNoteEditorLike} />,
  }
)()

'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDocPolls } from '@/lib/hooks/useDocPolls'
import { useVoterNames } from '@/lib/hooks/useVoterNames'
import { collectPollBlocks, planPollSync, pollIdOf, pollOwnersOf, reasonRequiredOf } from '@/lib/doc-polls/logic'
import type { DocPollReasonRequired, DocPollSource } from '@/lib/doc-polls/types'
import { DocPollContext, type DocPollContextValue } from './DocPollContext'

type BlockLike = { id: string; type: string; props?: Record<string, unknown>; children?: BlockLike[] }

/** 投票の番号を振り直し・作るのに使う分だけのエディタ（テストから偽物を渡せるように絞る） */
export interface DocPollEditorLike {
  document: BlockLike[]
  onChange?: (cb: () => void) => (() => void) | void
  updateBlock?: (block: BlockLike, update: { props: Record<string, unknown> }) => unknown
  transact?: (cb: (tr: { setMeta: (key: string, value: unknown) => unknown }) => unknown) => unknown
}

/** 一瞬つながらなかっただけのときに、作り直すまで待つ時間 */
const RETRY_DELAY_MS = 1000

function newPollId(): string {
  return crypto.randomUUID()
}

/**
 * ブロックの番号を書き換える。「元に戻す」の履歴には載せない。載せると、貼り付けを Ctrl+Z で
 * 戻そうとしたとき振り直しだけが戻り、番号がまた重なって振り直される…を繰り返して貼る前に戻れない
 * （そのたびに空の投票が DB に増える）。
 */
function setPollIdSilently(editor: DocPollEditorLike, block: BlockLike, pollId: string) {
  if (!editor.updateBlock) return
  const update = () => editor.updateBlock!(block, { props: { pollId } })
  if (!editor.transact) {
    update()
    return
  }
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    update()
  })
}

/**
 * 本文の外側に置き、中の投票ブロックへ「その文書の投票」と押し方を配る（1ページ1回の読み込み）。
 *
 * 本文を編集できる人の画面では、次の2つもここで行う（DOC_VOTE_SPEC §3.3）。
 * - DB にまだ無い投票を作る（「/」で置いた直後・作り損ねたもの・別の文書から貼ったもの）
 * - 番号が重なったブロック（同じ文書の中でコピーして貼ったもの）の番号を振り直す
 *   （振り直さないと、2つのブロックが同じ票を共有してしまう）。前からあった側が番号を持ち続ける
 * 別の文書から貼った番号は DB が「使用中」と返すので、そのときも振り直す。
 */
export function DocPollHost({
  editor,
  source,
  currentUserId,
  nameOf,
  editable,
  closedNote,
  children,
}: {
  editor: DocPollEditorLike
  source: DocPollSource
  currentUserId: string | null
  /** 名前の引き方。渡さない画面（相手先ポータル）では、押した人の名前をここで引く */
  nameOf?: (userId: string) => string
  editable: boolean
  /** 見えない・押せない投票に出す言葉（相手先ポータルが渡す） */
  closedNote?: string
  children: ReactNode
}) {
  const { polls, isFetched, castVote, createPoll } = useDocPolls(source)
  const fetchedNameOf = useVoterNames(nameOf ? null : polls)
  const resolveName = nameOf ?? fetchedNameOf

  // 作っている最中か、作り終えた・作れなかった番号。何度も作りに行かないために覚える
  const skipRef = useRef(new Set<string>())
  // 前に見たときの、番号ごとの持ち主のブロック。上に貼ったときに元の側を見分ける
  const ownersRef = useRef<Record<string, string>>({})
  // 作れなかった番号。そのブロックに案内を出す
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set())
  const pollsRef = useRef(polls)
  useEffect(() => {
    pollsRef.current = polls
  }, [polls])

  const markFailed = useCallback((pollId: string) => {
    setFailedIds((prev) => new Set(prev).add(pollId))
  }, [])

  const create = useCallback(
    async (pollId: string, reasonRequired: DocPollReasonRequired) => {
      skipRef.current.add(pollId)
      for (let attempt = 0; ; attempt++) {
        try {
          await createPoll(pollId, reasonRequired)
          return
        } catch (e) {
          const err = (e ?? {}) as { code?: string; message?: string }
          if (err.message === 'poll_id_in_use') break
          // 権限が無いなら作り直しても同じ。それ以外は一瞬つながらなかっただけかもしれないので1回だけ
          if (err.code === '42501' || attempt >= 1) {
            markFailed(pollId)
            return
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        }
      }
      // 別の文書の番号だった（そちらからコピーして貼った）。このブロックだけ新しい番号にする
      const block = collectPollBlocks(editor.document).find((b) => pollIdOf(b) === pollId)
      if (!block) return
      const next = newPollId()
      skipRef.current.add(next)
      setPollIdSilently(editor, block, next)
      ownersRef.current = pollOwnersOf(editor.document)
      await createPoll(next, reasonRequiredOf(block)).catch(() => markFailed(next))
    },
    [createPoll, editor, markFailed]
  )

  const sync = useCallback(() => {
    if (!editable || !isFetched) {
      ownersRef.current = pollOwnersOf(editor.document)
      return
    }
    const plan = planPollSync(editor.document, pollsRef.current, skipRef.current, ownersRef.current)
    for (const block of plan.renumber) {
      const next = newPollId()
      skipRef.current.add(next)
      setPollIdSilently(editor, block, next)
      void create(next, reasonRequiredOf(block))
    }
    for (const c of plan.create) void create(c.pollId, c.reasonRequired)
    ownersRef.current = pollOwnersOf(editor.document)
  }, [create, editable, editor, isFetched])

  // 本文が変わるたびに見直す。書き換えは変更の通知の最中を避けて、次の番で行う
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        sync()
      }, 0)
    }
    schedule()
    const off = editor.onChange?.(schedule)
    return () => {
      if (timer) clearTimeout(timer)
      if (typeof off === 'function') off()
    }
    // 見直すのは本文が変わったときと、読み込みが終わったとき（sync が変わる）だけ。
    // 票の中身は pollsRef で読むので、票が変わるたびに登録し直さない
  }, [editor, sync])

  const value = useMemo<DocPollContextValue>(
    () => ({ polls, isFetched, currentUserId, nameOf: resolveName, castVote, canCreate: editable, failedIds, closedNote }),
    [polls, isFetched, currentUserId, resolveName, castVote, editable, failedIds, closedNote]
  )

  return <DocPollContext.Provider value={value}>{children}</DocPollContext.Provider>
}

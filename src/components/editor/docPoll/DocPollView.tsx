'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckSquareOffset } from '@phosphor-icons/react'
import {
  DOC_VOTE_CHOICES,
  DOC_VOTE_LABELS,
  DOC_VOTE_MEMO_MAX,
  groupVotesByChoice,
  historyOf,
  needsReason,
  voteErrorMessage,
} from '@/lib/doc-polls/logic'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatNoteStamp, formatNoteStampLabel } from '@/lib/minutes/noteStamp'
import type { DocPollReasonRequired, DocPollState, DocVoteChoice, DocVoteEvent } from '@/lib/doc-polls/types'

/**
 * 投票ブロックの見た目。本文の中の1行（議題）と、その下の OK / NG / 保留のボタン・押した人の一覧。
 * 通信やエディタを持ち込まず、渡された票を描いて押されたら onCast を呼ぶだけ（テストから直接確かめる）。
 *
 * - loading      読み込み中
 * - ready        押せる
 * - preparing    本文に置いた直後で、投票をまだ作っている
 * - missing      投票が見つからない（作れる人が開くと作り直す）
 * - failed       作ろうとしたが作れなかった
 * - unavailable  この画面では投票できない（相手先ポータルなど。相手先が押せるのは PR3 から）
 */
export type DocPollStatus = 'loading' | 'ready' | 'preparing' | 'missing' | 'failed' | 'unavailable'

const STATUS_NOTE: Partial<Record<DocPollStatus, string>> = {
  loading: '読み込み中…',
  preparing: '投票を用意しています…',
  missing: 'この投票はまだ用意できていません',
  failed: 'この投票を用意できませんでした。ページを開き直してください',
  unavailable: 'この画面では投票できません',
}

// 選んだボタンの色。OK=緑 / NG=赤 / 保留=灰。アンバー/オレンジは「相手先に見える」印の色なので使わない
const SELECTED_CLASS: Record<DocVoteChoice, string> = {
  ok: 'border-green-500 bg-green-100 text-green-ink',
  ng: 'border-red-500 bg-red-50 text-red-600',
  hold: 'border-gray-400 bg-gray-100 text-gray-700',
}

const ACTION_LABEL: Record<DocVoteEvent['action'], string> = {
  cast: '押した',
  change: '選び直した',
  retract: '取り消した',
}

/** DB の時刻（UTC）を、日本時間の短い表示（`9/26 10:02`）にする */
function formatVoteTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return formatNoteStampLabel(formatNoteStamp(jstNow(d))) ?? ''
}

interface MemoTarget {
  choice: DocVoteChoice
  rect: DOMRect
}

export interface DocPollViewProps {
  /** 本文に書いてある設定。投票を読めるまではこちらで印を出す */
  reasonRequired: DocPollReasonRequired
  state?: DocPollState
  status: DocPollStatus
  currentUserId: string | null
  nameOf: (userId: string) => string
  /** 押す・選び直す（choice）・取り消す（null） */
  onCast: (choice: DocVoteChoice | null, memo: string) => Promise<void>
  /** 議題（本文の文字）を入れる場所。BlockNote が渡す */
  contentRef: (node: HTMLElement | null) => void
}

export function DocPollView({
  reasonRequired: reasonFromBlock,
  state,
  status,
  currentUserId,
  nameOf,
  onCast,
  contentRef,
}: DocPollViewProps) {
  const reasonRequired = state?.poll.reason_required ?? reasonFromBlock
  const votes = state?.votes ?? []
  const events = state?.events ?? []
  const groups = groupVotesByChoice(votes)
  const mine = currentUserId ? votes.find((v) => v.user_id === currentUserId) : undefined
  const canVote = status === 'ready' && currentUserId != null

  const [error, setError] = useState<string | null>(null)
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null)
  const [openHistory, setOpenHistory] = useState<string | null>(null)

  const send = async (choice: DocVoteChoice | null, memo: string) => {
    setError(null)
    try {
      await onCast(choice, memo)
      setMemoTarget(null)
    } catch (e) {
      setError(voteErrorMessage(e))
    }
  }

  const handleChoice = (choice: DocVoteChoice, el: HTMLElement) => {
    if (!canVote) return
    if (mine?.choice === choice) {
      void send(null, '')
      return
    }
    const memo = mine?.memo ?? ''
    if (needsReason(reasonRequired, choice, memo)) {
      setMemoTarget({ choice, rect: el.getBoundingClientRect() })
      return
    }
    void send(choice, memo)
  }

  return (
    <div
      data-testid="doc-poll"
      className="my-1 w-full rounded border border-gray-200 bg-surface px-3 py-2"
    >
      <div className="flex items-start gap-2">
        <span contentEditable={false} aria-hidden className="mt-0.5 shrink-0 select-none text-gray-400">
          <CheckSquareOffset size={18} />
        </span>
        {/* 議題。文字を持てるのはこの中だけ。空のままでもよい（ボタンだけの投票） */}
        <div className="min-w-0 flex-1 font-medium" ref={contentRef} />
        {reasonRequired === 'ng_hold' && (
          <span
            contentEditable={false}
            className="shrink-0 select-none rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500"
          >
            NG・保留は理由必須
          </span>
        )}
      </div>

      <div contentEditable={false} className="mt-2 select-none">
        <div className="flex flex-wrap items-center gap-1.5">
          {DOC_VOTE_CHOICES.map((choice) => {
            const selected = mine?.choice === choice
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={selected}
                aria-label={`${DOC_VOTE_LABELS[choice]} ${groups[choice].length}人`}
                disabled={!canVote}
                data-testid={`doc-poll-choice-${choice}`}
                onClick={(e) => handleChoice(choice, e.currentTarget)}
                className={`inline-flex items-center gap-1 rounded border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected ? SELECTED_CLASS[choice] : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{DOC_VOTE_LABELS[choice]}</span>
                <span className="tabular-nums text-[11px] opacity-80">{groups[choice].length}</span>
              </button>
            )
          })}
          {mine && canVote && (
            <button
              type="button"
              onClick={(e) => setMemoTarget({ choice: mine.choice, rect: e.currentTarget.getBoundingClientRect() })}
              className="ml-1 text-xs text-gray-500 hover:text-gray-700 hover:underline"
            >
              {mine.memo ? 'メモを直す' : 'メモを書く'}
            </button>
          )}
          {STATUS_NOTE[status] && <span className="ml-1 text-xs text-gray-400">{STATUS_NOTE[status]}</span>}
        </div>

        {error && (
          <div role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </div>
        )}

        {DOC_VOTE_CHOICES.filter((c) => groups[c].length > 0).map((choice) => (
          <div key={choice} data-testid={`doc-poll-group-${choice}`} className="mt-1.5 flex gap-2 text-xs">
            <span className="w-8 shrink-0 pt-0.5 text-gray-400">{DOC_VOTE_LABELS[choice]}</span>
            <ul className="min-w-0 flex-1 space-y-1">
              {groups[choice].map((v) => {
                const history = historyOf(events, v.user_id)
                return (
                  <li key={v.user_id}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-gray-700">{nameOf(v.user_id)}</span>
                      <span className="text-[10px] text-gray-400">{formatVoteTime(v.updated_at)}</span>
                      {history.length > 1 && (
                        <button
                          type="button"
                          aria-expanded={openHistory === v.user_id}
                          onClick={() => setOpenHistory((cur) => (cur === v.user_id ? null : v.user_id))}
                          className="text-[10px] text-gray-500 hover:underline"
                        >
                          変更あり
                        </button>
                      )}
                    </div>
                    {v.memo && <div className="whitespace-pre-wrap break-words text-gray-600">{v.memo}</div>}
                    {openHistory === v.user_id && (
                      <ol
                        data-testid={`doc-poll-history-${v.user_id}`}
                        className="mt-1 space-y-0.5 border-l border-gray-200 pl-2 text-[11px] text-gray-500"
                      >
                        {history.map((e) => (
                          <li key={e.id}>
                            <span className="mr-1.5 text-gray-400">{formatVoteTime(e.created_at)}</span>
                            {e.choice ? DOC_VOTE_LABELS[e.choice] : ''} {ACTION_LABEL[e.action]}
                            {e.memo && <span className="whitespace-pre-wrap">「{e.memo}」</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {memoTarget && (
        <MemoPopover
          choice={memoTarget.choice}
          anchor={memoTarget.rect}
          reasonRequired={reasonRequired}
          initialMemo={mine?.memo ?? ''}
          onSend={(memo) => send(memoTarget.choice, memo)}
          onClose={() => setMemoTarget(null)}
        />
      )}
    </div>
  )
}

const POPOVER_WIDTH = 320
const POPOVER_GAP = 6

/**
 * メモの入力欄。本文（エディタ）の外に浮かせる。本文の中に入力欄を置くと、Enter で行が
 * 分かれるなど、打った字をエディタが先に拾ってしまうため。
 * Esc・外を押すと閉じる（送らない）。Ctrl/⌘+Enter でも送れる。
 */
function MemoPopover({
  choice,
  anchor,
  reasonRequired,
  initialMemo,
  onSend,
  onClose,
}: {
  choice: DocVoteChoice
  anchor: DOMRect
  reasonRequired: DocPollReasonRequired
  initialMemo: string
  onSend: (memo: string) => Promise<void>
  onClose: () => void
}) {
  const [memo, setMemo] = useState(initialMemo)
  const [sending, setSending] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const label = DOC_VOTE_LABELS[choice]
  const required = reasonRequired === 'ng_hold' && choice !== 'ok'
  const blocked = needsReason(reasonRequired, choice, memo) || memo.length > DOC_VOTE_MEMO_MAX || sending

  useLayoutEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    // 本文を動かすと、浮かせた欄だけがボタンから離れて残るので閉じる（書きかけは残らない）
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const submit = async () => {
    if (blocked) return
    setSending(true)
    try {
      await onSend(memo)
    } finally {
      setSending(false)
    }
  }

  if (typeof document === 'undefined') return null
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8))
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={required ? `${label} の理由` : `${label} のメモ`}
      className="z-50 rounded-lg border border-gray-200 bg-surface p-2 shadow-popover"
      style={{ position: 'fixed', top: anchor.bottom + POPOVER_GAP, left, width: POPOVER_WIDTH }}
    >
      <textarea
        ref={textareaRef}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={3}
        maxLength={DOC_VOTE_MEMO_MAX}
        placeholder={required ? `${label} の理由（必須）` : 'メモ（なくてもよい）'}
        className="w-full resize-y rounded border border-gray-200 bg-surface px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] text-gray-400">Ctrl / ⌘ + Enter でも送れます</span>
        <button
          type="button"
          disabled={blocked}
          onClick={() => void submit()}
          // gray-900 はダークで明るい色に反転して白文字が消えるので、両テーマで変わらない blue-600 にする
          className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {label} で送る
        </button>
      </div>
    </div>,
    document.body
  )
}

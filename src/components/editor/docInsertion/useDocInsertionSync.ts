'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fetchDocInsertions, markDocInsertionApplied, markDocInsertionRemoved } from '@/lib/doc-insertions/api'
import { DOC_INSERTION_TYPE, type DocInsertion } from '@/lib/doc-insertions/logic'
import { planInsertionSync } from '@/lib/doc-insertions/plan'
import { onDocSignal, sendDocSignal } from '@/lib/hooks/useDocVoteSignal'
import { serializeMinutesBlocks } from '@/lib/minutes/markdown'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatNoteStamp } from '@/lib/minutes/noteStamp'

type BlockLike = { id: string; type: string; props?: Record<string, unknown>; children?: BlockLike[] }

/** 差し込みを本文に入れるのに使う分だけのエディタ（テストから偽物を渡せるように絞る） */
export interface InsertionEditorLike {
  document: BlockLike[]
  insertBlocks: (blocks: never[], ref: string, placement: 'after') => unknown
  removeBlocks: (ids: string[]) => unknown
  transact?: (cb: (tr: { setMeta: (key: string, value: unknown) => unknown }) => unknown) => unknown
}

/** 相手先が足した・取り下げたの知らせを取りこぼしたときの保険 */
const REFETCH_MS = 30_000

/** 議事録の最上位の行を、足す場所（相手先の画面が送ってくる、その行の Markdown）と比べる */
function matchesMinutesAnchor(block: BlockLike, anchor: string): boolean {
  try {
    return serializeMinutesBlocks([block]).trim() === anchor.trim()
  } catch {
    return false
  }
}

/**
 * 社内の議事録の編集画面が、相手先の差し込み（反映待ち・削除依頼）を本文に取り込む（DOC_VOTE_SPEC §5）。
 * 取り込むのは1つのタブだけ（同時編集中は書記。呼ぶ側が enabled で決める）。
 *
 * - 反映待ちは足す場所の後ろに入れる。「元に戻す」の履歴には載せない（社内の Ctrl+Z で相手先の行が消えないように）
 * - 反映済み・削除済みにするのは保存のあと（minutes-saved）。本文に目印が入った／消えたことは DB が確かめるので、
 *   保存の前にタブが閉じても、印だけが先に立つことはない（次に開いた人がまた取り込む。目印で二重にならない）
 */
export function useDocInsertionSync({
  editor,
  meetingId,
  enabled,
}: {
  editor: InsertionEditorLike
  meetingId: string
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const topic = `meeting-minutes-view:${meetingId}`
  const queryKey = useMemo(() => ['docInsertions', 'sync', 'meeting', meetingId] as const, [meetingId])
  // 足す場所が見つからず末尾に付けたか（反映済みにするときに台帳へ残す）
  const missedRef = useRef(new Map<string, boolean>())

  const { data: rows } = useQuery({
    queryKey,
    queryFn: () => fetchDocInsertions(supabase, { meetingId }, ['pending', 'remove_requested']),
    enabled,
    refetchInterval: enabled ? REFETCH_MS : false,
    staleTime: 5_000,
  })

  /** 本文に入れる・消す（保存は通常の自動保存に任せる） */
  const applyToEditor = useCallback(
    (list: DocInsertion[]) => {
      const plan = planInsertionSync(editor.document, list, matchesMinutesAnchor)
      if (plan.insert.length === 0 && plan.remove.length === 0) return
      const run = () => {
        for (const { row, afterBlockId, missed } of plan.insert) {
          missedRef.current.set(row.id, missed)
          editor.insertBlocks(
            [
              {
                id: row.id,
                type: DOC_INSERTION_TYPE,
                props: {
                  insertionId: row.id,
                  kind: row.kind,
                  author: row.author_name,
                  createdAt: formatNoteStamp(jstNow(new Date(row.created_at))),
                },
                content: row.content,
              } as never,
            ],
            afterBlockId,
            'after'
          )
        }
        if (plan.remove.length) editor.removeBlocks(plan.remove)
      }
      if (editor.transact) {
        editor.transact((tr) => {
          tr.setMeta('addToHistory', false)
          run()
        })
      } else {
        run()
      }
    },
    [editor]
  )

  /** 反映済み・削除済みにする（DB が本文を確かめる。保存の前なら断られるので、次の保存のあとにまた確かめる） */
  const confirmIds = useCallback(
    async (markApplied: string[], markRemoved: string[]) => {
      let changed = false
      for (const id of markApplied) {
        try {
          await markDocInsertionApplied(supabase, id, missedRef.current.get(id) ?? false)
          missedRef.current.delete(id)
          changed = true
        } catch {
          // 保存の前（not_in_body）など
        }
      }
      for (const id of markRemoved) {
        try {
          await markDocInsertionRemoved(supabase, id)
          changed = true
        } catch {
          // 保存の前（still_in_body）など
        }
      }
      if (changed) {
        sendDocSignal(topic, 'insertion-changed')
        void queryClient.invalidateQueries({ queryKey })
      }
    },
    [queryClient, queryKey, supabase, topic]
  )

  /** 保存のあと: 今の本文にある分を反映済みに、無くなった分を削除済みにする */
  const confirmWithServer = useCallback(
    async (list: DocInsertion[]) => {
      const plan = planInsertionSync(editor.document, list, matchesMinutesAnchor)
      await confirmIds(plan.markApplied, plan.markRemoved)
    },
    [editor, confirmIds]
  )

  const rowsRef = useRef<DocInsertion[] | undefined>(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  // 台帳が届いた・変わったら本文に入れる。入れる前から本文にあった分だけは、保存済みかもしれないので確かめる
  // （いま入れた分はまだ保存されていない。保存のあとの知らせで確かめる）
  useEffect(() => {
    if (!enabled || !rows?.length) return
    const before = planInsertionSync(editor.document, rows, matchesMinutesAnchor)
    applyToEditor(rows)
    void confirmIds(before.markApplied, before.markRemoved)
  }, [enabled, rows, applyToEditor, confirmIds, editor])

  useEffect(() => {
    if (!enabled) return
    const offChanged = onDocSignal(topic, 'insertion-changed', () => {
      void queryClient.invalidateQueries({ queryKey })
    })
    // 保存が通ったら確かめる（同じ画面の保存の知らせは sendDocSignal が中でも届ける）
    const offSaved = onDocSignal(topic, 'minutes-saved', () => {
      if (rowsRef.current?.length) void confirmWithServer(rowsRef.current)
    })
    return () => {
      offChanged()
      offSaved()
    }
  }, [enabled, topic, queryClient, queryKey, confirmWithServer])
}

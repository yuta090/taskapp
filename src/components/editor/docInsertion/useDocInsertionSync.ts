'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  claimDocInsertion,
  dismissDocInsertion,
  fetchDocInsertions,
  markDocInsertionApplied,
  markDocInsertionRemoved,
} from '@/lib/doc-insertions/api'
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

/** 台帳から読む状態。取り消し（withdrawn）も読む: 取り込んで保存する前に取り消されたら、本文から消すため */
const SYNC_STATUSES = ['pending', 'remove_requested', 'withdrawn'] as const

/** 議事録の最上位の行を、足す場所（相手先の画面が送ってくる、その行の Markdown）と比べる */
function matchesMinutesAnchor(block: BlockLike, anchor: string): boolean {
  try {
    return serializeMinutesBlocks([block]).trim() === anchor.trim()
  } catch {
    return false
  }
}

/**
 * 社内の議事録の編集画面が、相手先の差し込みを本文に取り込む（DOC_VOTE_SPEC §5・§5.1）。
 *
 * - 取り込む前に、差し込み1件ごとに DB で「取り込む権利」を取る（2分）。取れたタブだけが本文に入れる。
 *   同時編集を使わない組織やスマホでは編集できる画面が全部ここに来るので、取らないと同じ行が2回入る
 * - 入れるときは「元に戻す」の履歴に載せない（社内の Ctrl+Z で相手先の行が消えないように）
 * - 反映済み・削除済みにするのは保存のあと（minutes-saved）。本文に目印が入った／消えたことは DB が確かめる
 * - 自分が入れた行を社内が保存の前に消したら、「採らなかった」として閉じる（入れ直さない）
 * - 取り消された（withdrawn）のに本文にある行は消す（取り込んで保存する前に取り消されたとき）
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
  // このタブの札（取り込む権利を持つタブを見分ける）
  const tabIdRef = useRef<string | null>(null)
  if (tabIdRef.current == null) tabIdRef.current = crypto.randomUUID()
  // 足す場所が見つからず末尾に付けたか（反映済みにするときに台帳へ残す）
  const missedRef = useRef(new Map<string, boolean>())
  // このタブが本文に入れた差し込み。本文から消えていたら「採らなかった」
  const insertedRef = useRef(new Set<string>())
  // 見直しを重ねない（途中で次が来たら、終わってからもう1回）
  const runningRef = useRef(false)
  const againRef = useRef<{ confirm: boolean } | null>(null)

  const { data: rows, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: () => fetchDocInsertions(supabase, { meetingId }, [...SYNC_STATUSES]),
    enabled,
    refetchInterval: enabled ? REFETCH_MS : false,
    staleTime: 5_000,
  })
  const rowsRef = useRef<DocInsertion[] | undefined>(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const insertAndRemove = useCallback(
    (insert: ReturnType<typeof planInsertionSync>['insert'], remove: string[]) => {
      if (insert.length === 0 && remove.length === 0) return
      const run = () => {
        for (const { row, afterBlockId, missed } of insert) {
          missedRef.current.set(row.id, missed)
          insertedRef.current.add(row.id)
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
        if (remove.length) editor.removeBlocks(remove)
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

  /**
   * 1回の見直し。confirm は保存のあと（本文が DB に入った）かどうか。
   * 反映済み・削除済み・採らなかったの確認は、本文が入れる前から持っていた分について毎回行う
   * （DB が本文を確かめるので、保存の前なら断られて次にまた確かめる）
   */
  const pass = useCallback(
    async (list: DocInsertion[], confirm: boolean) => {
      if (runningRef.current) {
        againRef.current = { confirm: confirm || (againRef.current?.confirm ?? false) }
        return
      }
      runningRef.current = true
      try {
        const plan = planInsertionSync(editor.document, list, matchesMinutesAnchor)
        // 自分が入れたのに本文から消えている＝社内が採らなかった。入れ直さない
        const dismiss = plan.insert.filter((x) => insertedRef.current.has(x.row.id)).map((x) => x.row.id)
        const candidates = plan.insert.filter((x) => !insertedRef.current.has(x.row.id))

        const claimed = new Set<string>()
        for (const x of candidates) {
          try {
            if (await claimDocInsertion(supabase, x.row.id, tabIdRef.current as string)) claimed.add(x.row.id)
          } catch {
            // 取れなかった。次の見直しでまた試す
          }
        }
        // 権利を待つ間に本文が変わっているかもしれないので、足す場所は今の本文で決め直す
        const fresh = planInsertionSync(
          editor.document,
          list.filter((r) => r.status !== 'pending' || claimed.has(r.id)),
          matchesMinutesAnchor
        )
        insertAndRemove(
          fresh.insert.filter((x) => claimed.has(x.row.id)),
          fresh.remove
        )

        let changed = false
        const attempt = async (fn: () => Promise<void>) => {
          try {
            await fn()
            changed = true
          } catch {
            // 保存の前（not_in_body / still_in_body）など。次の保存のあとにまた確かめる
          }
        }
        for (const id of plan.markApplied) {
          await attempt(async () => {
            await markDocInsertionApplied(supabase, id, missedRef.current.get(id) ?? false)
            missedRef.current.delete(id)
          })
        }
        for (const id of plan.markRemoved) await attempt(() => markDocInsertionRemoved(supabase, id))
        if (confirm) {
          for (const id of dismiss) {
            // 閉じたあとも「このタブが入れた」の覚えは消さない（台帳の読み直しが遅れても入れ直さない）
            await attempt(() => dismissDocInsertion(supabase, id))
          }
        }
        if (changed) {
          sendDocSignal(topic, 'insertion-changed')
          void queryClient.invalidateQueries({ queryKey })
        }
      } finally {
        runningRef.current = false
        const again = againRef.current
        againRef.current = null
        if (again && rowsRef.current) void pass(rowsRef.current, again.confirm)
      }
    },
    [editor, insertAndRemove, queryClient, queryKey, supabase, topic]
  )

  // 台帳を読んだら（読み直しのたびにも）見直す。中身が同じでも読み直しの時刻で回す
  useEffect(() => {
    if (!enabled || !rows?.length) return
    void pass(rows, false)
  }, [enabled, rows, dataUpdatedAt, pass])

  useEffect(() => {
    if (!enabled) return
    const offChanged = onDocSignal(topic, 'insertion-changed', () => {
      void queryClient.invalidateQueries({ queryKey })
    })
    // 保存が通ったら確かめる（同じ画面の保存の知らせは sendDocSignal が中でも届ける）
    const offSaved = onDocSignal(topic, 'minutes-saved', () => {
      if (rowsRef.current?.length) void pass(rowsRef.current, true)
    })
    return () => {
      offChanged()
      offSaved()
    }
  }, [enabled, topic, queryClient, queryKey, pass])
}

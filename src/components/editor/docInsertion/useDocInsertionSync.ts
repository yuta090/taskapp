'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  claimDocInsertion,
  dismissDocInsertion,
  keepDocInsertion,
  fetchInsertionsToSync,
  markDocInsertionApplied,
  markDocInsertionRemoved,
} from '@/lib/doc-insertions/api'
import { DOC_INSERTION_TYPE, type DocInsertion } from '@/lib/doc-insertions/logic'
import type { DocInsertionSource } from '@/lib/doc-insertions/api'
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

/** Wiki は足す場所をブロックの id で持つ */
function matchesWikiAnchor(block: BlockLike, anchor: string): boolean {
  return block.id === anchor
}

/**
 * 社内の編集画面（議事録・Wiki）が、相手先の差し込みを本文に取り込む（DOC_VOTE_SPEC §5・§5.1）。
 * 保存のあとの知らせは、議事録は minutes-saved、Wiki は wiki-saved（どちらも同じ画面の中で届く）。
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
  source,
  enabled,
}: {
  editor: InsertionEditorLike
  source: DocInsertionSource
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const isWiki = source.wikiPageId != null
  const docId = (source.wikiPageId ?? source.meetingId) as string
  const topic = isWiki ? `wiki-page-view:${docId}` : `meeting-minutes-view:${docId}`
  const savedEvent = isWiki ? 'wiki-saved' : 'minutes-saved'
  const matches = isWiki ? matchesWikiAnchor : matchesMinutesAnchor
  const queryKey = useMemo(() => ['docInsertions', 'sync', isWiki ? 'wiki' : 'meeting', docId] as const, [isWiki, docId])
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
    // 反映待ち・削除依頼と、最近の取り消し（取り込んで保存する前に取り消されたら本文から消すため）
    queryFn: () => fetchInsertionsToSync(supabase, isWiki ? { wikiPageId: docId } : { meetingId: docId }),
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
        const plan = planInsertionSync(editor.document, list, matches)
        // 自分が入れたのに本文から消えている＝社内が採らなかった。入れ直さない
        const dismiss = plan.insert.filter((x) => insertedRef.current.has(x.row.id)).map((x) => x.row.id)
        const candidates = plan.insert.filter((x) => !insertedRef.current.has(x.row.id))

        // 権利はまとめて同時に取りに行く（1件ずつ待たない）
        const claimed = new Set<string>()
        const results = await Promise.all(
          candidates.map((x) =>
            claimDocInsertion(supabase, x.row.id, tabIdRef.current as string).catch(() => false)
          )
        )
        candidates.forEach((x, i) => {
          if (results[i]) claimed.add(x.row.id)
        })
        // 権利を待つ間に本文が変わっているかもしれないので、足す場所は今の本文で決め直す
        const fresh = planInsertionSync(
          editor.document,
          list.filter((r) => r.status !== 'pending' || claimed.has(r.id)),
          matches
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
        for (const id of plan.keep) await attempt(() => keepDocInsertion(supabase, id))
        // 「採らなかった」は見直しのたびに確かめる（同時編集では保存するのが別のタブ＝書記で、
        // こちらには保存の知らせが来ない。DB が本文に無いことを確かめるので、早すぎても害は無い）。
        // 閉じたあとも「このタブが入れた」の覚えは消さない（台帳の読み直しが遅れても入れ直さない）
        for (const id of dismiss) await attempt(() => dismissDocInsertion(supabase, id))
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
    [editor, insertAndRemove, matches, queryClient, queryKey, supabase, topic]
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
    const offSaved = onDocSignal(topic, savedEvent, () => {
      if (rowsRef.current?.length) void pass(rowsRef.current, true)
    })
    return () => {
      offChanged()
      offSaved()
    }
  }, [enabled, topic, savedEvent, queryClient, queryKey, pass])
}

'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getCachedUser } from '@/lib/supabase/cached-auth'

/**
 * タスクの未読のコメント。コメントが付くと DB のトリガー（20260915105122_task_comment_notify）が
 * 担当者・承認者・これまでコメントした人・名指しされた人に受信トレイのお知らせを作る。
 * その未読をタスクごとに数える（コメントの既読を別の表に持たず、受信トレイと同じ既読を使う）。
 *
 * 既読にするのは、読み込んだコメント一覧が画面に入ったとき（TaskComments）。受信トレイの同じ
 * お知らせも一緒に既読になる。
 */

/** コメントのお知らせの種類。名指しされた人には mention、ほかの人には comment_added が届く */
export const COMMENT_NOTIFICATION_TYPES = ['comment_added', 'mention'] as const

export interface UnreadTaskComments {
  count: number
  /** 未読のコメントを書いた人の表示名（重複なし・新しい順） */
  fromNames: string[]
}

export type UnreadTaskCommentsMap = Record<string, UnreadTaskComments>

/** 読むのは payload の2項目だけ（本文の抜粋までは運ばない） */
export interface UnreadTaskCommentRow {
  task_id: string | null
  from_user_name: string | null
}

/** 未読として読む上限。1人の担当タスクは多くて数十件なので、届いた順に新しいものから十分に足りる */
const UNREAD_COMMENT_LIMIT = 500

// 読み込み中・失敗時に毎レンダー新しい {} を作らない（useTaskCommentCounts と同じ考え方）
const EMPTY_UNREAD: UnreadTaskCommentsMap = {}

const UNREAD_KEY_PREFIX = ['unreadTaskComments'] as const

export function unreadTaskCommentsQueryKey(userId: string | null, orgId: string | null) {
  return [...UNREAD_KEY_PREFIX, userId, orgId ?? null] as const
}

export function unreadTaskCommentsFromRows(
  rows: UnreadTaskCommentRow[] | null | undefined
): UnreadTaskCommentsMap {
  const result: UnreadTaskCommentsMap = {}
  for (const row of rows ?? []) {
    if (!row.task_id) continue
    const entry = (result[row.task_id] ??= { count: 0, fromNames: [] })
    entry.count += 1
    if (row.from_user_name && !entry.fromNames.includes(row.from_user_name)) {
      entry.fromNames.push(row.from_user_name)
    }
  }
  return result
}

/**
 * マイタスク一覧（MyTasksClient）向け。自分宛ての未読のコメントのお知らせを、タスクごとに数える。
 */
export function useMyUnreadTaskComments(
  userId: string | null,
  orgId: string | null,
  /** 呼び出し側の読み込み条件。マイタスク本体と同じく、組織の判定が終わるまでは false を渡す */
  options: { enabled?: boolean } = {}
): UnreadTaskCommentsMap {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data } = useQuery<UnreadTaskCommentsMap>({
    queryKey: unreadTaskCommentsQueryKey(userId, orgId),
    // 失敗は投げる。空を「成功」として返すと、表示中の未読を消してしまう
    queryFn: async () => {
      if (!userId) throw new Error('ログインが必要です')
      let query = (supabase as SupabaseClient)
        .from('notifications')
        .select('task_id:payload->>task_id, from_user_name:payload->>from_user_name')
        .eq('to_user_id', userId)
        .eq('channel', 'in_app')
        .in('type', [...COMMENT_NOTIFICATION_TYPES])
        .is('read_at', null)
      if (orgId) query = query.eq('org_id', orgId)
      const { data, error } = await query.order('created_at', { ascending: false }).limit(UNREAD_COMMENT_LIMIT)
      if (error) {
        console.warn('[useMyUnreadTaskComments] 未読のコメントを読めませんでした:', error)
        throw error
      }
      return unreadTaskCommentsFromRows(data as UnreadTaskCommentRow[] | null)
    },
    // 受信トレイの一覧（useNotifications）と同じ間隔。受信トレイで読んだ分を、マイタスクを開き直したときに映す
    staleTime: 30_000,
    refetchOnMount: 'always',
    enabled: !!userId && (options.enabled ?? true),
  })

  return data ?? EMPTY_UNREAD
}

/** 既読の目印にする、自分以外が書いたいちばん新しいコメント（お知らせは自分以外のコメントにだけ届く） */
export interface LatestTaskComment {
  id: string
  /** サーバーが付けた書き込み時刻（task_comments.created_at） */
  createdAt: string
}

/**
 * 端末の時計とサーバーの時刻のずれの見込み。未読の一覧が最新のコメントよりこの分以上あとに取られていれば、
 * その一覧は最新のコメントのお知らせまで含んでいるとみなす
 */
const CLOCK_SKEW_MARGIN_MS = 60_000

/** タスクごとに、最後に既読にしたときの「自分以外の最新コメント」の id。同じなら新しいお知らせは届いていない */
const markedLatestCommentByTask = new Map<string, string>()

/** テスト用。既読にした記録を消す */
export function resetRecentlyMarkedTaskComments(): void {
  markedLatestCommentByTask.clear()
}

interface MarkTaskCommentsReadInput {
  supabase: SupabaseClient
  queryClient: QueryClient
  taskId: string
  /** タスクの組織。別の組織の未読の一覧では判断しないため */
  orgId: string | null
  latestComment: LatestTaskComment
  /** 本人のID。書き込むと決まってから呼ぶ（書かないときに認証の往復を出さない） */
  resolveUserId: () => Promise<string | null>
}

/**
 * そのタスクの未読のコメントのお知らせを既読にする。
 *
 * 書き込みを省くのは、既読にするものが無いと確かに言えるときだけ:
 * - そのタスクに未読があると分かっているときは、必ず書き込む
 * - 前に既読にしたときから「自分以外の最新コメント」が変わっていなければ省く（行き来するたびに書かない）
 * - 最新コメントより後に取った同じ組織の未読の一覧に、そのタスクが無ければ省く
 * 受信トレイの未読数（['unreadCount']）では判断しない。更新を購読していないので、新しいコメントが付いても
 * 0のまま残り、読んだのに未読が残ってしまう。
 *
 * 一覧の「未読 N」は、サーバーの返事を待たずに先に消す（取得時刻は据え置く）。取り直しの最中なら止めてから
 * 消し、書き込みのあとで取り直す（古い結果で「未読 N」が戻らないように。useNotifications の beginWrite と
 * 同じ考え方）。失敗したら元に戻す。1件以上既読にしたら、受信トレイの一覧と左メニューの未読数も取り直す。
 */
export async function markTaskCommentsRead({
  supabase,
  queryClient,
  taskId,
  orgId,
  latestComment,
  resolveUserId,
}: MarkTaskCommentsReadInput): Promise<void> {
  const findUnreadQueries = () => queryClient.getQueryCache().findAll({ queryKey: UNREAD_KEY_PREFIX })
  const knownUnread = findUnreadQueries().some(
    (query) => ((query.state.data as UnreadTaskCommentsMap | undefined)?.[taskId]?.count ?? 0) > 0
  )

  if (!knownUnread) {
    if (markedLatestCommentByTask.get(taskId) === latestComment.id) return
    const latestAt = Date.parse(latestComment.createdAt)
    const coveredByFreshList =
      Number.isFinite(latestAt) &&
      findUnreadQueries().some((query) => {
        const queryOrgId = query.queryKey[2]
        const listed = query.state.data as UnreadTaskCommentsMap | undefined
        // 上限まで読んだ一覧は、古い未読が切れている（全部入っているとは言えない）
        const total = listed ? Object.values(listed).reduce((sum, entry) => sum + entry.count, 0) : 0
        return (
          query.state.status === 'success' &&
          total < UNREAD_COMMENT_LIMIT &&
          (queryOrgId === null || queryOrgId === orgId) &&
          query.state.dataUpdatedAt - CLOCK_SKEW_MARGIN_MS > latestAt
        )
      })
    if (coveredByFreshList) {
      markedLatestCommentByTask.set(taskId, latestComment.id)
      return
    }
  }

  const userId = await resolveUserId()
  if (!userId) return
  // 書き込みの最中に同じタスクでもう一度呼ばれても、重ねて書かない（失敗したら消す）
  markedLatestCommentByTask.set(taskId, latestComment.id)

  const wasFetching = queryClient.isFetching({ queryKey: UNREAD_KEY_PREFIX }) > 0
  if (wasFetching) await queryClient.cancelQueries({ queryKey: UNREAD_KEY_PREFIX })

  const removed: Array<{ queryKey: QueryKey; entry: UnreadTaskComments }> = []
  for (const query of findUnreadQueries()) {
    const old = query.state.data as UnreadTaskCommentsMap | undefined
    const entry = old?.[taskId]
    if (!old || !entry) continue
    const next = { ...old }
    delete next[taskId]
    queryClient.setQueryData(query.queryKey, next, { updatedAt: query.state.dataUpdatedAt })
    removed.push({ queryKey: query.queryKey, entry })
  }

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('to_user_id', userId)
    .eq('channel', 'in_app')
    .in('type', [...COMMENT_NOTIFICATION_TYPES])
    .is('read_at', null)
    .eq('payload->>task_id', taskId)
    .select('id')

  if (error) {
    console.warn('[markTaskCommentsRead] コメントのお知らせを既読にできませんでした:', error)
    if (markedLatestCommentByTask.get(taskId) === latestComment.id) markedLatestCommentByTask.delete(taskId)
    for (const { queryKey, entry } of removed) {
      const current = queryClient.getQueryData<UnreadTaskCommentsMap>(queryKey)
      // 待っている間に取り直して新しい数が入っていれば、そちらを残す
      if (!current || current[taskId]) continue
      queryClient.setQueryData(queryKey, { ...current, [taskId]: entry }, {
        updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt,
      })
    }
    if (wasFetching) void queryClient.invalidateQueries({ queryKey: UNREAD_KEY_PREFIX })
    return
  }

  const updatedCount = data?.length ?? 0
  if (updatedCount > 0) {
    void queryClient.invalidateQueries({ queryKey: ['unreadCount'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }
  if (updatedCount > 0 || wasFetching) {
    void queryClient.invalidateQueries({ queryKey: UNREAD_KEY_PREFIX })
  }
}

/**
 * コメント欄（TaskComments）の一覧が画面に入ったときに、そのタスクの未読のコメントを既読にする。
 * 詳細パネルの下のほうで開いただけ（まだ見えていない）では既読にしない。新しいコメントが届いて
 * 「自分以外の最新コメント」が変わったら、もう一度判断する。
 */
export function useMarkTaskCommentsReadWhenSeen({
  taskId,
  orgId,
  latestComment,
  targetRef,
}: {
  taskId: string
  orgId: string | null
  /** 読み込んだコメントのうち、自分以外が書いたいちばん新しいもの。無ければ既読にするお知らせも無い */
  latestComment: LatestTaskComment | null
  /** 画面に入ったかを見る要素。コメント一覧の末尾（いちばん新しいコメントの下）を渡す */
  targetRef: RefObject<HTMLElement | null>
}): void {
  const queryClient = useQueryClient()
  const latestId = latestComment?.id ?? null
  const latestAt = latestComment?.createdAt ?? null

  useEffect(() => {
    if (!latestId || !latestAt) return
    let cancelled = false

    const markRead = () => {
      const client = createClient()
      void markTaskCommentsRead({
        supabase: client as SupabaseClient,
        queryClient,
        taskId,
        orgId,
        latestComment: { id: latestId, createdAt: latestAt },
        // 本人のIDは、QueryProvider が通信なしで入れておく ['currentUser'] から取る。無いときだけ本人確認を待つ
        resolveUserId: async () => {
          const cached = queryClient.getQueryData<{ id?: string } | null>(['currentUser'])
          if (cached?.id) return cached.id
          const { user } = await getCachedUser(client)
          return cancelled ? null : user?.id ?? null
        },
      }).catch((err) => {
        console.warn('[useMarkTaskCommentsReadWhenSeen] 既読にできませんでした:', err)
      })
    }

    const target = targetRef.current
    if (!target || typeof IntersectionObserver === 'undefined') {
      markRead()
      return () => {
        cancelled = true
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      markRead()
    })
    observer.observe(target)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [queryClient, taskId, orgId, latestId, latestAt, targetRef])
}

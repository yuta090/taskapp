'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/** channel_messages は types/database.ts に無いためローカル定義 */
export interface ChannelMessageRow {
  id: string
  org_id: string
  space_id: string | null
  identity_id: string | null
  account_id: string | null
  channel: string
  direction: 'inbound' | 'outbound'
  actor: 'client' | 'secretary' | 'staff' | 'system'
  external_user_id: string | null
  content_type: string
  body: string | null
  storage_path: string | null
  status: 'received' | 'queued' | 'sent' | 'failed'
  error: string | null
  redacted_at: string | null
  occurred_at: string
  created_at: string
  /** optimistic送信中/失敗時のみクライアント側で付与 */
  isOptimistic?: boolean
}

const MESSAGE_COLUMNS =
  'id, org_id, space_id, identity_id, account_id, channel, direction, actor, external_user_id, content_type, body, storage_path, status, error, redacted_at, occurred_at, created_at'

/** 1ページ/ポーリング1回あたりの取得件数 */
export const MESSAGE_PAGE_SIZE = 50

export interface SendMessageResult {
  ok: boolean
  error?: string
}

/** keysetページングのカーソル: そのページの最古行の(created_at, id) */
interface PageCursor {
  createdAt: string
  id: string
}

interface MessagesPage {
  rows: ChannelMessageRow[]
  /** 次(より古い)ページを取るためのカーソル。これ以上古い行が無ければnull */
  cursor: PageCursor | null
}

type TimelineData = InfiniteData<MessagesPage, PageCursor | null>

function sortDesc(rows: ChannelMessageRow[]): ChannelMessageRow[] {
  return [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1
    if (a.id === b.id) return 0
    return a.id > b.id ? -1 : 1
  })
}

function computeCursor(descRows: ChannelMessageRow[]): PageCursor | null {
  const oldest = descRows[descRows.length - 1]
  return descRows.length === MESSAGE_PAGE_SIZE && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null
}

/**
 * ポーラー(直近50件)の結果を先頭ページ(pages[0]=最新)へマージする。
 *
 * - 通常時: fresh(サーバの直近50件)と現pages[0]をidでunion(サーバ行優先=status等の更新を反映)。
 *   optimisticなtemp行(送信中/失敗)はサーバにまだ存在しない限り保持する。unionのため
 *   ウィンドウからこぼれた古い実データもpages[0]に残り続け、表示の連続性が壊れない
 *   (ページ間に隙間を作らない)。
 * - 安全弁: freshが満杯(50件)なのにpages[0]の実データと1件も重複しない場合、ポーリング間隔中に
 *   50件を超える新着があり連続性を保証できない(ギャップが生じる)とみなし、pages全体を
 *   [fresh]へリセットする(=最新へジャンプ。ギャップは絶対に描画しない)。
 */
function mergeLatestIntoFirstPage(data: TimelineData | undefined, fresh: ChannelMessageRow[]): TimelineData {
  if (!data || data.pages.length === 0) {
    return { pages: [{ rows: fresh, cursor: computeCursor(fresh) }], pageParams: [null] }
  }

  const [firstPage, ...restPages] = data.pages
  const freshIds = new Set(fresh.map((row) => row.id))
  const overlapCount = firstPage.rows.reduce((count, row) => count + (freshIds.has(row.id) ? 1 : 0), 0)
  const hasRealRows = firstPage.rows.some((row) => !row.isOptimistic)

  if (fresh.length === MESSAGE_PAGE_SIZE && overlapCount === 0 && hasRealRows) {
    return { pages: [{ rows: fresh, cursor: computeCursor(fresh) }], pageParams: [null] }
  }

  const byId = new Map<string, ChannelMessageRow>()
  for (const row of firstPage.rows) byId.set(row.id, row)
  for (const row of fresh) byId.set(row.id, row) // サーバ行が後勝ちで上書き

  return {
    ...data,
    pages: [{ ...firstPage, rows: sortDesc([...byId.values()]), cursor: firstPage.cursor }, ...restPages],
  }
}

function mapMessageInFirstPage(
  data: TimelineData | undefined,
  id: string,
  updater: (message: ChannelMessageRow) => ChannelMessageRow,
): TimelineData | undefined {
  if (!data || data.pages.length === 0) return data
  const [firstPage, ...restPages] = data.pages
  return {
    ...data,
    pages: [
      { ...firstPage, rows: firstPage.rows.map((m) => (m.id === id ? updater(m) : m)) },
      ...restPages,
    ],
  }
}

function removeMessageFromFirstPage(data: TimelineData | undefined, id: string): TimelineData | undefined {
  if (!data || data.pages.length === 0) return data
  const [firstPage, ...restPages] = data.pages
  return {
    ...data,
    pages: [{ ...firstPage, rows: firstPage.rows.filter((m) => m.id !== id) }, ...restPages],
  }
}

/**
 * space毎の会話タイムライン。設計(案A'): 「表示用infiniteクエリ」と「ポーラー」を分離する。
 *
 * - 履歴(infinite)クエリ: keysetページング(直近50件/ページ)。`staleTime: Infinity`かつ
 *   refetchIntervalを持たない = 一度取得したページは自動で再取得されない(不変)。
 *   `fetchNextPage`で古い履歴を末尾に積み増す。
 * - ポーラー(独立クエリ): 直近50件を`refetchInterval`(30秒)で取り直す。取得のたびに
 *   `pages[0]`へunionマージする(mergeLatestIntoFirstPage参照)。
 *
 * この分離により、ポーリングの実DB問い合わせは常に「直近50件を1回」で有界化され、
 * かつ履歴を何ページ遡っても最新メッセージがキャッシュから失われない
 * (旧maxPages方式は`fetchNextPage`でpages[0]自体が破棄されるバグがあったため廃止)。
 *
 * isLinked=false(未連携space)ではポーラーを止める。履歴の初回取得自体は連携解除後も
 * 見られるようenabledはspace選択の有無だけで判定する。
 */
export function useChannelTimeline(orgId: string, spaceId: string | null, isLinked: boolean = true) {
  const queryClient = useQueryClient()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(() => ['channelMessages', orgId, spaceId] as const, [orgId, spaceId])
  const latestQueryKey = useMemo(() => ['channelLatest', orgId, spaceId] as const, [orgId, spaceId])

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<MessagesPage, Error, TimelineData, typeof queryKey, PageCursor | null>({
    queryKey,
    queryFn: async ({ pageParam }): Promise<MessagesPage> => {
      if (!orgId || !spaceId) return { rows: [], cursor: null }

      let query = supabase
        .from('channel_messages')
        .select(MESSAGE_COLUMNS)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)

      if (pageParam) {
        // 直近ページの最古行より古い行だけを取る(offsetを使わないためポーリング中の追記で行ずれしない)
        query = query.or(
          `created_at.lt.${pageParam.createdAt},and(created_at.eq.${pageParam.createdAt},id.lt.${pageParam.id})`,
        )
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE)

      if (error) throw error
      const rows = (data ?? []) as ChannelMessageRow[]
      return { rows, cursor: computeCursor(rows) }
    },
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled: !!orgId && !!spaceId,
    staleTime: Infinity,
  })

  const latestQuery = useQuery<ChannelMessageRow[]>({
    queryKey: latestQueryKey,
    queryFn: async (): Promise<ChannelMessageRow[]> => {
      if (!orgId || !spaceId) return []

      const { data, error } = await supabase
        .from('channel_messages')
        .select(MESSAGE_COLUMNS)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE)

      if (error) throw error
      return (data ?? []) as ChannelMessageRow[]
    },
    enabled: !!orgId && !!spaceId,
    refetchInterval: isLinked ? 30_000 : false,
  })

  const latestData = latestQuery.data
  useEffect(() => {
    if (!latestData) return
    queryClient.setQueryData<TimelineData>(queryKey, (old) => mergeLatestIntoFirstPage(old, latestData))
  }, [latestData, queryClient, queryKey])

  /** ページ群を表示用に平坦化し、created_at, id 昇順(古→新)へ整列する */
  const messages = useMemo<ChannelMessageRow[]>(() => {
    const allRows = (data?.pages ?? []).flatMap((page) => page.rows)
    return [...allRows].sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
      if (a.id === b.id) return 0
      return a.id < b.id ? -1 : 1
    })
  }, [data])

  /** 手動更新導線(ヘッダーの更新ボタン・「最新へ」)はポーラーのrefetchに一本化する */
  const refreshLatest = useCallback(() => {
    void latestQuery.refetch()
  }, [latestQuery])

  const sendMessage = useCallback(
    async (text: string): Promise<SendMessageResult> => {
      if (!spaceId) return { ok: false, error: '連携先が選択されていません' }

      const tempId = `temp-${crypto.randomUUID()}`
      const now = new Date().toISOString()
      const optimisticMessage: ChannelMessageRow = {
        id: tempId,
        org_id: orgId,
        space_id: spaceId,
        identity_id: null,
        account_id: null,
        channel: 'line',
        direction: 'outbound',
        actor: 'secretary',
        external_user_id: null,
        content_type: 'text',
        body: text,
        storage_path: null,
        status: 'queued',
        error: null,
        redacted_at: null,
        occurred_at: now,
        created_at: now,
        isOptimistic: true,
      }

      // 最新(先頭)ページへ楽観追加。先頭ページは降順(新→古)なので配列の先頭に足す。
      queryClient.setQueryData<TimelineData>(queryKey, (old) => {
        if (!old || old.pages.length === 0) {
          return { pages: [{ rows: [optimisticMessage], cursor: null }], pageParams: [null] }
        }
        const [firstPage, ...restPages] = old.pages
        return {
          ...old,
          pages: [{ ...firstPage, rows: [optimisticMessage, ...firstPage.rows] }, ...restPages],
        }
      })

      try {
        const response = await fetch('/api/channels/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, spaceId, text }),
        })
        const json = await response.json()

        if (!response.ok) {
          queryClient.setQueryData<TimelineData>(queryKey, (old) =>
            mapMessageInFirstPage(old, tempId, (m) => ({
              ...m,
              status: 'failed',
              error: json.error ?? '送信に失敗しました',
            })),
          )
          return { ok: false, error: json.error ?? '送信に失敗しました' }
        }

        queryClient.setQueryData<TimelineData>(queryKey, (old) =>
          mapMessageInFirstPage(old, tempId, (m) => ({
            ...m,
            id: json.id as string,
            status: (json.status ?? 'sent') as ChannelMessageRow['status'],
            isOptimistic: false,
          })),
        )
        return { ok: true }
      } catch {
        queryClient.setQueryData<TimelineData>(queryKey, (old) =>
          mapMessageInFirstPage(old, tempId, (m) => ({
            ...m,
            status: 'failed',
            error: 'ネットワークエラーが発生しました',
          })),
        )
        return { ok: false, error: 'ネットワークエラーが発生しました' }
      }
    },
    [orgId, spaceId, queryClient, queryKey],
  )

  /**
   * status='failed' な行の再送。sendMessage(text)をそのまま呼ぶと失敗行を残したまま
   * 新規のoptimisticバブルが追加され二重表示になるため、先に失敗行を消してから送り直す。
   */
  const retryMessage = useCallback(
    async (failedMessage: ChannelMessageRow): Promise<SendMessageResult> => {
      queryClient.setQueryData<TimelineData>(queryKey, (old) =>
        removeMessageFromFirstPage(old, failedMessage.id),
      )
      return sendMessage(failedMessage.body ?? '')
    },
    [queryClient, queryKey, sendMessage],
  )

  return {
    messages,
    isLoading,
    isRefreshing: latestQuery.isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
    refreshLatest,
    sendMessage,
    retryMessage,
    fetchNextPage,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
  }
}

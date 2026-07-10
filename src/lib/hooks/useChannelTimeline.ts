'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

export interface SendMessageResult {
  ok: boolean
  error?: string
}

/**
 * space毎の会話タイムライン。手動更新＋30秒ポーリング。
 * 送信はoptimistic append(送信ボタン無し・即時反映)し、失敗時はエラー表示+リトライ導線用に
 * 該当メッセージを status='failed' のまま残す。
 *
 * isLinked=false(未連携space)ではポーリングを止める(無駄な30秒毎の問い合わせを避ける)。
 * 履歴の初回取得自体は連携解除後も見られるようenabledはspace選択の有無だけで判定する。
 */
export function useChannelTimeline(orgId: string, spaceId: string | null, isLinked: boolean = true) {
  const queryClient = useQueryClient()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(() => ['channelMessages', orgId, spaceId] as const, [orgId, spaceId])

  const { data, isLoading, error, refetch, isFetching } = useQuery<ChannelMessageRow[]>({
    queryKey,
    queryFn: async (): Promise<ChannelMessageRow[]> => {
      if (!orgId || !spaceId) return []

      const { data, error } = await supabase
        .from('channel_messages')
        .select(MESSAGE_COLUMNS)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data ?? []) as ChannelMessageRow[]
    },
    enabled: !!orgId && !!spaceId,
    refetchInterval: isLinked ? 30_000 : false,
  })

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

      queryClient.setQueryData<ChannelMessageRow[]>(queryKey, (old) => [
        ...(old ?? []),
        optimisticMessage,
      ])

      try {
        const response = await fetch('/api/channels/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, spaceId, text }),
        })
        const json = await response.json()

        if (!response.ok) {
          queryClient.setQueryData<ChannelMessageRow[]>(queryKey, (old) =>
            (old ?? []).map((m) =>
              m.id === tempId
                ? { ...m, status: 'failed', error: json.error ?? '送信に失敗しました' }
                : m,
            ),
          )
          return { ok: false, error: json.error ?? '送信に失敗しました' }
        }

        queryClient.setQueryData<ChannelMessageRow[]>(queryKey, (old) =>
          (old ?? []).map((m) =>
            m.id === tempId
              ? { ...m, id: json.id as string, status: (json.status ?? 'sent') as ChannelMessageRow['status'], isOptimistic: false }
              : m,
          ),
        )
        return { ok: true }
      } catch {
        queryClient.setQueryData<ChannelMessageRow[]>(queryKey, (old) =>
          (old ?? []).map((m) =>
            m.id === tempId ? { ...m, status: 'failed', error: 'ネットワークエラーが発生しました' } : m,
          ),
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
      queryClient.setQueryData<ChannelMessageRow[]>(queryKey, (old) =>
        (old ?? []).filter((m) => m.id !== failedMessage.id),
      )
      return sendMessage(failedMessage.body ?? '')
    },
    [queryClient, queryKey, sendMessage],
  )

  return {
    messages: data ?? [],
    isLoading,
    isRefreshing: isFetching,
    error: error instanceof Error ? error.message : null,
    refetch,
    sendMessage,
    retryMessage,
  }
}

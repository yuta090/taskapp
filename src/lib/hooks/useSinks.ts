'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * 外部連携シンク（integration_sinks）の一覧・作成・更新フック。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §3(API) / §4(UI)。
 *
 * 一覧はreact-queryのGETラッパー。作成・更新は保存ボタンを持たず、
 * 呼び出し側のフォーム操作（トグル・onBlur等）から即時にmutateする
 * optimistic update（useChannelAccount.tsと同型: 楽観反映→レスポンスで確定→失敗はロールバック）。
 */

export type SinkProvider = 'webhook' | 'notion' | 'google_sheets'
export type SinkStatus = 'active' | 'disabled' | 'error'

export interface SinkLastDelivery {
  status: string
  eventType: string
  createdAt: string
}

export interface SinkMeta {
  id: string
  orgId: string
  groupId: string | null
  provider: SinkProvider
  displayName: string
  config: Record<string, unknown>
  connectionId: string | null
  events: string[]
  status: SinkStatus
  consecutiveFailures: number
  lastDeliveredAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  lastDelivery: SinkLastDelivery | null
}

export type ViewerRole = 'owner' | 'admin' | 'member'

interface SinksResponse {
  sinks: SinkMeta[]
  viewerRole: ViewerRole | null
}

export const ALLOWED_SINK_EVENTS = ['task.created', 'task.done', 'task.dismissed', 'task.reopened'] as const
export const DEFAULT_SINK_EVENTS: string[] = ['task.created', 'task.done', 'task.dismissed']

function sinksQueryKey(orgId: string) {
  return ['integrationSinks', orgId] as const
}

/** org のsink一覧＋直近配達状況（GET /api/integrations/sinks） */
export function useSinks(orgId: string) {
  const queryKey = useMemo(() => sinksQueryKey(orgId), [orgId])

  const { data, isLoading, error, refetch } = useQuery<SinksResponse>({
    queryKey,
    queryFn: async (): Promise<SinksResponse> => {
      const response = await fetch(`/api/integrations/sinks?orgId=${encodeURIComponent(orgId)}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '連携シンクの取得に失敗しました')
      return json as SinksResponse
    },
    enabled: !!orgId,
    staleTime: 15_000,
  })

  return {
    sinks: data?.sinks ?? [],
    viewerRole: data?.viewerRole ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  }
}

export interface CreateSinkInput {
  orgId: string
  groupId?: string | null
  displayName: string
  url: string
  events: string[]
}

/**
 * webhookシンクの作成（POST）。PR-1 APIはprovider='webhook'のみ受け付ける。
 * secretはレスポンスに一度だけ含まれる（呼び出し側で一度だけ表示・再取得不可）。
 */
export function useCreateSink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateSinkInput): Promise<{ sink: SinkMeta; secret: string }> => {
      const response = await fetch('/api/integrations/sinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: input.orgId,
          groupId: input.groupId ?? null,
          provider: 'webhook',
          displayName: input.displayName,
          config: { url: input.url },
          events: input.events,
        }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'シンクの作成に失敗しました')
      return json as { sink: SinkMeta; secret: string }
    },
    onSuccess: (result, input) => {
      const queryKey = sinksQueryKey(input.orgId)
      queryClient.setQueryData<SinksResponse>(queryKey, (old) => {
        const createdSink: SinkMeta = { ...result.sink, lastDelivery: null }
        return old ? { ...old, sinks: [...old.sinks, createdSink] } : { sinks: [createdSink], viewerRole: null }
      })
    },
  })
}

export interface UpdateSinkInput {
  orgId: string
  sinkId: string
  displayName?: string
  url?: string
  events?: string[]
  status?: 'active' | 'disabled'
  rotateSecret?: boolean
}

/**
 * シンク設定の更新（PATCH）: 表示名・URL・イベント購読・有効/無効・secretローテーション。
 * 保存ボタンを持たないため、フィールド操作のたびに呼び出す前提でoptimistic updateする。
 * rotateSecretは新secretを一度だけ返す（呼び出し側で表示し、以後は破棄する）。
 */
export function useUpdateSink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateSinkInput): Promise<{ sink: SinkMeta; secret?: string }> => {
      const body: Record<string, unknown> = {}
      if (input.displayName !== undefined) body.displayName = input.displayName
      if (input.url !== undefined) body.config = { url: input.url }
      if (input.events !== undefined) body.events = input.events
      if (input.status !== undefined) body.status = input.status
      if (input.rotateSecret) body.rotateSecret = true

      const response = await fetch(`/api/integrations/sinks/${input.sinkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '更新に失敗しました')
      return json as { sink: SinkMeta; secret?: string }
    },
    onMutate: async (input) => {
      const queryKey = sinksQueryKey(input.orgId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<SinksResponse>(queryKey)

      queryClient.setQueryData<SinksResponse>(queryKey, (old) => {
        if (!old) return old
        return {
          ...old,
          sinks: old.sinks.map((sink) => {
            if (sink.id !== input.sinkId) return sink
            return {
              ...sink,
              ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
              ...(input.url !== undefined ? { config: { ...sink.config, url: input.url } } : {}),
              ...(input.events !== undefined ? { events: input.events } : {}),
              ...(input.status !== undefined
                ? {
                    status: input.status,
                    consecutiveFailures: input.status === 'active' ? 0 : sink.consecutiveFailures,
                  }
                : {}),
            }
          }),
        }
      })

      return { previous, queryKey }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous)
    },
    onSuccess: (result, input) => {
      const queryKey = sinksQueryKey(input.orgId)
      queryClient.setQueryData<SinksResponse>(queryKey, (old) => {
        if (!old) return old
        return {
          ...old,
          sinks: old.sinks.map((existing) =>
            existing.id === result.sink.id
              ? { ...result.sink, lastDelivery: existing.lastDelivery }
              : existing,
          ),
        }
      })
    },
  })
}

/** テスト配達（POST /sinks/[id]/test、event:'ping'）。結果を同期的に返す */
export function useTestSinkDelivery() {
  return useMutation({
    mutationFn: async (sinkId: string): Promise<{ deliveryId: string; outcome: unknown }> => {
      const response = await fetch(`/api/integrations/sinks/${sinkId}/test`, { method: 'POST' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'テスト配達に失敗しました')
      return json as { deliveryId: string; outcome: unknown }
    },
  })
}

/** sink単位の一括再送（POST /sinks/[id]/redeliver、dead/failed全件） */
export function useRedeliverSink() {
  return useMutation({
    mutationFn: async (params: { orgId: string; sinkId: string }): Promise<{ ok: boolean; count: number }> => {
      const response = await fetch(`/api/integrations/sinks/${params.sinkId}/redeliver`, { method: 'POST' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '再送に失敗しました')
      return json as { ok: boolean; count: number }
    },
  })
}

/** 呼び出し側で「無効化する/有効化する/secretを再生成する」を短く書くための補助 */
export function useSinkActions() {
  const updateSink = useUpdateSink()

  const setStatus = useCallback(
    (orgId: string, sinkId: string, status: 'active' | 'disabled') =>
      updateSink.mutateAsync({ orgId, sinkId, status }),
    [updateSink],
  )

  const rotateSecret = useCallback(
    (orgId: string, sinkId: string) => updateSink.mutateAsync({ orgId, sinkId, rotateSecret: true }),
    [updateSink],
  )

  return { setStatus, rotateSecret, isPending: updateSink.isPending }
}

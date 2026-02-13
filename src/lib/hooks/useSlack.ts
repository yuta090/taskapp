'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { isSlackConfigured } from '@/lib/slack/config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = createClient()

/**
 * 組織のSlack Workspace連携状態を取得
 */
export function useSlackWorkspace(orgId: string | undefined) {
  const slackEnabled = isSlackConfigured()

  return useQuery({
    queryKey: ['slack-workspace', orgId],
    queryFn: async () => {
      if (!orgId) return null

      const { data, error } = await supabase
        .from('slack_workspaces')
        .select('id, team_id, team_name, app_id, token_obtained_at')
        .eq('org_id', orgId)
        .not('bot_token_encrypted', 'is', null)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!orgId && slackEnabled,
  })
}

/**
 * Spaceに紐付けられたSlackチャンネルを取得
 */
export function useSlackChannel(spaceId: string | undefined) {
  const slackEnabled = isSlackConfigured()

  return useQuery({
    queryKey: ['slack-channel', spaceId],
    queryFn: async () => {
      if (!spaceId) return null

      const { data, error } = await supabase
        .from('space_slack_channels')
        .select('*')
        .eq('space_id', spaceId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!spaceId && slackEnabled,
  })
}

/**
 * Botがアクセス可能なSlackチャンネル一覧を取得
 */
export function useSlackChannelList(orgId: string | undefined) {
  const slackEnabled = isSlackConfigured()

  return useQuery({
    queryKey: ['slack-channel-list', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const res = await fetch(`/api/slack/channels?orgId=${orgId}`)
      if (!res.ok) throw new Error('Failed to fetch channels')
      const data = await res.json()
      return data.channels as Array<{ id: string; name: string; is_private: boolean }>
    },
    enabled: !!orgId && slackEnabled,
  })
}

/**
 * SpaceにSlackチャンネルを紐付け
 */
export function useLinkSlackChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      spaceId: string
      channelId: string
      channelName: string
    }) => {
      const res = await fetch('/api/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to link channel')
      }

      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['slack-channel', variables.spaceId],
      })
    },
  })
}

/**
 * Spaceのチャンネル紐付けを解除
 */
export function useUnlinkSlackChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (spaceId: string) => {
      const res = await fetch(`/api/slack/channels?spaceId=${spaceId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to unlink channel')
      }

      return res.json()
    },
    onSuccess: (_, spaceId) => {
      queryClient.invalidateQueries({
        queryKey: ['slack-channel', spaceId],
      })
    },
  })
}

/**
 * 手動でBot Tokenを登録
 */
export function useSaveSlackToken() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { orgId: string; botToken: string }) => {
      const res = await fetch('/api/slack/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to save token')
      }

      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['slack-workspace', variables.orgId],
      })
      queryClient.invalidateQueries({
        queryKey: ['slack-channel-list', variables.orgId],
      })
    },
  })
}

/**
 * Slack連携を解除
 */
export function useDisconnectSlack() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orgId: string) => {
      const res = await fetch(`/api/slack/token?orgId=${orgId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to disconnect')
      }

      return res.json()
    },
    onSuccess: (_, orgId) => {
      queryClient.invalidateQueries({
        queryKey: ['slack-workspace', orgId],
      })
      queryClient.invalidateQueries({
        queryKey: ['slack-channel-list', orgId],
      })
    },
  })
}

/**
 * 通知トグルの更新
 */
export function useUpdateNotifyToggles() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      spaceId: string
      toggles: {
        notify_task_created?: boolean
        notify_ball_passed?: boolean
        notify_status_changed?: boolean
        notify_comment_added?: boolean
      }
    }) => {
      const { error } = await supabase
        .from('space_slack_channels')
        .update(params.toggles)
        .eq('space_id', params.spaceId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['slack-channel', variables.spaceId],
      })
    },
  })
}

/**
 * タスクをSlackに投稿
 */
export function usePostToSlack() {
  return useMutation({
    mutationFn: async (params: {
      taskId: string
      spaceId: string
      customMessage?: string
    }) => {
      const res = await fetch('/api/slack/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to post to Slack')
      }

      return res.json()
    },
  })
}

'use client'

import { useCallback, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fireNotification } from '@/lib/slack/notify'
import type {
  TaskComment,
  TaskCommentInsert,
  CommentVisibility,
} from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

interface UseTaskCommentsOptions {
  orgId: string
  spaceId: string
  taskId: string
  /** If true, only fetch 'client' visibility comments (for client portal) */
  clientOnly?: boolean
}

export interface CommentWithProfile extends TaskComment {
  actor_name?: string
  actor_avatar_url?: string | null
}

export interface CreateCommentInput {
  body: string
  visibility?: CommentVisibility
  replyToId?: string
}

export interface UpdateCommentInput {
  body: string
}

interface UseTaskCommentsReturn {
  comments: CommentWithProfile[]
  loading: boolean
  error: Error | null
  fetchComments: () => Promise<void>
  createComment: (input: CreateCommentInput) => Promise<TaskComment>
  updateComment: (commentId: string, input: UpdateCommentInput) => Promise<void>
  softDeleteComment: (commentId: string) => Promise<void>
  /** Check if comment can be edited (author && within 24h) */
  canEdit: (comment: TaskComment, currentUserId: string) => boolean
}

/** 24 hours in milliseconds */
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

export function useTaskComments({
  orgId,
  spaceId,
  taskId,
  clientOnly = false,
}: UseTaskCommentsOptions): UseTaskCommentsReturn {
  const queryClient = useQueryClient()

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // ユーザーIDキャッシュ（auth.getUser()の重複呼び出し回避）
  const userIdRef = useRef<string | null>(null)

  // 認証状態変更時にキャッシュ無効化（logout/relogin対策）
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      userIdRef.current = null
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  const queryKey = useMemo(() => ['taskComments', taskId] as const, [taskId])

  const { data, isPending, error: queryError } = useQuery<CommentWithProfile[]>({
    queryKey,
    queryFn: async (): Promise<CommentWithProfile[]> => {
      // Build query
      let query = supabase
        .from('task_comments')
        .select('*')
        .eq('org_id' as never, orgId as never)
        .eq('space_id' as never, spaceId as never)
        .eq('task_id' as never, taskId as never)
        .is('deleted_at' as never, null)
        .order('created_at', { ascending: true })

      // Filter by visibility for client portal
      if (clientOnly) {
        query = query.eq('visibility' as never, 'client' as never)
      }

      const { data: commentsData, error: fetchError } = await query

      if (fetchError) throw fetchError

      const commentsList = (commentsData || []) as TaskComment[]

      // Fetch profile info for actors
      const actorIds = [...new Set(commentsList.map((c) => c.actor_id))]
      if (actorIds.length > 0) {
        const { data: profilesData } = await (supabase as SupabaseClient)
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', actorIds)

        const profileMap = new Map<string, { display_name: string; avatar_url: string | null }>(
          (profilesData || []).map((p: { id: string; display_name: string; avatar_url: string | null }) => [
            p.id,
            { display_name: p.display_name, avatar_url: p.avatar_url },
          ])
        )

        return commentsList.map((c) => {
          const profile = profileMap.get(c.actor_id)
          return {
            ...c,
            actor_name: profile?.display_name || c.actor_id.slice(0, 8) + '...',
            actor_avatar_url: profile?.avatar_url || null,
          }
        })
      }

      return commentsList
    },
    staleTime: 30_000,
    enabled: !!taskId,
  })

  const comments = data ?? []

  const fetchComments = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const createComment = useCallback(
    async (input: CreateCommentInput): Promise<TaskComment> => {
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()

      // Get current user (キャッシュ活用)
      if (!userIdRef.current) {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (authError || !authData?.user) {
          throw new Error('ログインが必要です')
        }
        userIdRef.current = authData.user.id
      }
      const userId = userIdRef.current

      // If clientOnly mode, always use 'client' visibility
      const visibility = clientOnly ? 'client' : (input.visibility || 'client')

      // Optimistic comment
      const optimisticComment: CommentWithProfile = {
        id: tempId,
        org_id: orgId,
        space_id: spaceId,
        task_id: taskId,
        actor_id: userId,
        body: input.body,
        visibility,
        reply_to_id: input.replyToId || null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        actor_name: 'あなた',
        actor_avatar_url: null,
      }

      // Optimistic update
      queryClient.setQueryData<CommentWithProfile[]>(queryKey, (old) =>
        [...(old ?? []), optimisticComment]
      )

      try {
        const insertData: TaskCommentInsert = {
          org_id: orgId,
          space_id: spaceId,
          task_id: taskId,
          actor_id: userId,
          body: input.body,
          visibility,
          reply_to_id: input.replyToId || null,
        }

        const { data: created, error: createError } = await (supabase as SupabaseClient)
          .from('task_comments')
          .insert(insertData)
          .select('*')
          .single()

        if (createError) throw createError

        const createdComment = created as TaskComment

        // Replace optimistic with real
        queryClient.setQueryData<CommentWithProfile[]>(queryKey, (old) =>
          (old ?? []).map((c) =>
            c.id === tempId
              ? { ...createdComment, actor_name: optimisticComment.actor_name, actor_avatar_url: optimisticComment.actor_avatar_url }
              : c
          )
        )

        // Fire-and-forget Slack notification (only for client-visible comments)
        if (visibility === 'client') {
          fireNotification({
            event: 'comment_added',
            taskId,
            spaceId,
            changes: { commentBody: input.body },
          })
        }

        return createdComment
      } catch (err) {
        // Revert optimistic update
        queryClient.setQueryData<CommentWithProfile[]>(queryKey, (old) =>
          (old ?? []).filter((c) => c.id !== tempId)
        )
        throw err
      }
    },
    [orgId, spaceId, taskId, clientOnly, supabase, queryClient, queryKey]
  )

  const updateComment = useCallback(
    async (commentId: string, input: UpdateCommentInput): Promise<void> => {
      // Store previous for rollback
      const prevComments = queryClient.getQueryData<CommentWithProfile[]>(queryKey)

      // Optimistic update
      queryClient.setQueryData<CommentWithProfile[]>(queryKey, (old) =>
        (old ?? []).map((c) =>
          c.id === commentId
            ? { ...c, body: input.body, updated_at: new Date().toISOString() }
            : c
        )
      )

      try {
        const { error: updateError } = await (supabase as SupabaseClient)
          .from('task_comments')
          .update({ body: input.body })
          .eq('id', commentId)

        if (updateError) throw updateError
      } catch (err) {
        // Revert optimistic update
        if (prevComments) {
          queryClient.setQueryData<CommentWithProfile[]>(queryKey, prevComments)
        }
        throw err
      }
    },
    [supabase, queryClient, queryKey]
  )

  const softDeleteComment = useCallback(
    async (commentId: string): Promise<void> => {
      // Store previous for rollback
      const prevComments = queryClient.getQueryData<CommentWithProfile[]>(queryKey)

      // Optimistic update - remove from list
      queryClient.setQueryData<CommentWithProfile[]>(queryKey, (old) =>
        (old ?? []).filter((c) => c.id !== commentId)
      )

      try {
        const { error: deleteError } = await (supabase as SupabaseClient)
          .from('task_comments')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', commentId)

        if (deleteError) throw deleteError
      } catch (err) {
        // Revert optimistic update
        if (prevComments) {
          queryClient.setQueryData<CommentWithProfile[]>(queryKey, prevComments)
        }
        throw err
      }
    },
    [supabase, queryClient, queryKey]
  )

  const canEdit = useCallback(
    (comment: TaskComment, currentUserId: string): boolean => {
      // Must be author
      if (comment.actor_id !== currentUserId) return false
      // Must not be deleted
      if (comment.deleted_at) return false
      // Must be within 24h
      const createdAt = new Date(comment.created_at).getTime()
      const now = Date.now()
      return now - createdAt < EDIT_WINDOW_MS
    },
    []
  )

  return {
    comments,
    loading: isPending && !data,
    error: queryError instanceof Error ? queryError : null,
    fetchComments,
    createComment,
    updateComment,
    softDeleteComment,
    canEdit,
  }
}

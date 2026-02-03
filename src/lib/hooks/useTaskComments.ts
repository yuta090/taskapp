'use client'

import { useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  TaskComment,
  TaskCommentInsert,
  CommentVisibility,
} from '@/types/database'

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
  const [comments, setComments] = useState<CommentWithProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const fetchComments = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: profilesData } = await (supabase as any)
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', actorIds)

        const profileMap = new Map<string, { display_name: string; avatar_url: string | null }>(
          (profilesData || []).map((p: { id: string; display_name: string; avatar_url: string | null }) => [
            p.id,
            { display_name: p.display_name, avatar_url: p.avatar_url },
          ])
        )

        const commentsWithProfile: CommentWithProfile[] = commentsList.map((c) => {
          const profile = profileMap.get(c.actor_id)
          return {
            ...c,
            actor_name: profile?.display_name || c.actor_id.slice(0, 8) + '...',
            actor_avatar_url: profile?.avatar_url || null,
          }
        })

        setComments(commentsWithProfile)
      } else {
        setComments(commentsList)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch comments'))
    } finally {
      setLoading(false)
    }
  }, [orgId, spaceId, taskId, clientOnly, supabase])

  const createComment = useCallback(
    async (input: CreateCommentInput): Promise<TaskComment> => {
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()

      // Get current user
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError || !authData?.user) {
        throw new Error('ログインが必要です')
      }
      const userId = authData.user.id

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

      setComments((prev) => [...prev, optimisticComment])

      try {
        // If clientOnly mode, always use 'client' visibility
        const visibility = clientOnly ? 'client' : (input.visibility || 'client')

        const insertData: TaskCommentInsert = {
          org_id: orgId,
          space_id: spaceId,
          task_id: taskId,
          actor_id: userId,
          body: input.body,
          visibility,
          reply_to_id: input.replyToId || null,
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: created, error: createError } = await (supabase as any)
          .from('task_comments')
          .insert(insertData)
          .select('*')
          .single()

        if (createError) throw createError

        const createdComment = created as TaskComment

        // Replace optimistic with real
        setComments((prev) =>
          prev.map((c) =>
            c.id === tempId
              ? { ...createdComment, actor_name: optimisticComment.actor_name, actor_avatar_url: optimisticComment.actor_avatar_url }
              : c
          )
        )

        return createdComment
      } catch (err) {
        // Revert optimistic update
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        setError(err instanceof Error ? err : new Error('Failed to create comment'))
        throw err
      }
    },
    [orgId, spaceId, taskId, clientOnly, supabase]
  )

  const updateComment = useCallback(
    async (commentId: string, input: UpdateCommentInput): Promise<void> => {
      // Store previous body for per-item rollback (avoid stale snapshot issues)
      let prevBody: string | undefined

      // Optimistic update
      setComments((prev) =>
        prev.map((c) => {
          if (c.id === commentId) {
            prevBody = c.body
            return { ...c, body: input.body, updated_at: new Date().toISOString() }
          }
          return c
        })
      )

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase as any)
          .from('task_comments')
          .update({ body: input.body })
          .eq('id', commentId)

        if (updateError) throw updateError
      } catch (err) {
        // Revert optimistic update (per-item rollback)
        if (prevBody !== undefined) {
          setComments((prev) =>
            prev.map((c) =>
              c.id === commentId ? { ...c, body: prevBody! } : c
            )
          )
        }
        setError(err instanceof Error ? err : new Error('Failed to update comment'))
        throw err
      }
    },
    [supabase]
  )

  const softDeleteComment = useCallback(
    async (commentId: string): Promise<void> => {
      // Store removed comment for per-item rollback (avoid stale snapshot issues)
      let removedComment: CommentWithProfile | undefined
      let removedIndex = -1

      // Optimistic update - remove from list
      setComments((prev) => {
        removedIndex = prev.findIndex((c) => c.id === commentId)
        if (removedIndex !== -1) {
          removedComment = prev[removedIndex]
        }
        return prev.filter((c) => c.id !== commentId)
      })

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: deleteError } = await (supabase as any)
          .from('task_comments')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', commentId)

        if (deleteError) throw deleteError
      } catch (err) {
        // Revert optimistic update (per-item rollback)
        if (removedComment) {
          setComments((prev) => {
            const newComments = [...prev]
            // Insert back at original position or end
            const insertIndex = removedIndex >= 0 && removedIndex <= newComments.length
              ? removedIndex
              : newComments.length
            newComments.splice(insertIndex, 0, removedComment!)
            return newComments
          })
        }
        setError(err instanceof Error ? err : new Error('Failed to delete comment'))
        throw err
      }
    },
    [supabase]
  )

  const canEdit = useCallback(
    (comment: TaskComment, currentUserId: string): boolean => {
      // Must be author
      if (comment.actor_id !== currentUserId) return false
      // Must be deleted
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
    loading,
    error,
    fetchComments,
    createComment,
    updateComment,
    softDeleteComment,
    canEdit,
  }
}

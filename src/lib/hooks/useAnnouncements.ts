'use client'

import { useCallback, useContext, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

export interface Announcement {
  id: string
  org_id: string | null
  title: string
  body: string
  category: 'info' | 'feature' | 'maintenance' | 'important'
  created_at: string
  read_at: string | null
}

export function useAnnouncements() {
  const queryClient = useQueryClient()
  const { activeOrgId, loading: orgLoading } = useContext(ActiveOrgContext)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = useMemo(
    () => ['announcements', activeOrgId] as const,
    [activeOrgId]
  )

  const { data: announcements = [], isPending } = useQuery<Announcement[]>({
    queryKey,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      // Fetch announcements with read status via left join
      const { data, error } = await (supabase as SupabaseClient)
        .from('announcements')
        .select(`
          id, org_id, title, body, category, created_at,
          announcement_reads!left(read_at)
        `)
        .eq('published', true)
        .eq('announcement_reads.user_id', user.id)
        .or(activeOrgId ? `org_id.is.null,org_id.eq.${activeOrgId}` : 'org_id.is.null')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      return (data ?? []).map((row: Record<string, unknown>) => {
        const reads = row.announcement_reads as Array<{ read_at: string }> | null
        return {
          id: row.id as string,
          org_id: row.org_id as string | null,
          title: row.title as string,
          body: row.body as string,
          category: row.category as Announcement['category'],
          created_at: row.created_at as string,
          read_at: reads && reads.length > 0 ? reads[0].read_at : null,
        }
      })
    },
    staleTime: 60_000,
    enabled: !orgLoading,
  })

  const unreadCount = useMemo(
    () => announcements.filter((a) => a.read_at === null).length,
    [announcements]
  )

  const markAsReadMutation = useMutation({
    mutationFn: async (announcementId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await (supabase as SupabaseClient)
        .from('announcement_reads')
        .upsert(
          { announcement_id: announcementId, user_id: user.id },
          { onConflict: 'announcement_id,user_id' }
        )
    },
    onMutate: async (announcementId) => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<Announcement[]>(queryKey)
      queryClient.setQueryData<Announcement[]>(queryKey, (old) =>
        (old ?? []).map((a) =>
          a.id === announcementId
            ? { ...a, read_at: new Date().toISOString() }
            : a
        )
      )
      return { prev }
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev)
    },
  })

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const unread = announcements.filter((a) => a.read_at === null)
      if (unread.length === 0) return

      const rows = unread.map((a) => ({
        announcement_id: a.id,
        user_id: user.id,
      }))

      await (supabase as SupabaseClient)
        .from('announcement_reads')
        .upsert(rows, { onConflict: 'announcement_id,user_id' })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<Announcement[]>(queryKey)
      queryClient.setQueryData<Announcement[]>(queryKey, (old) =>
        (old ?? []).map((a) =>
          a.read_at === null
            ? { ...a, read_at: new Date().toISOString() }
            : a
        )
      )
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev)
    },
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    announcements,
    unreadCount,
    loading: isPending,
    markAsRead: (id: string) => markAsReadMutation.mutate(id),
    markAllAsRead: () => markAllAsRead.mutate(),
    refresh,
  }
}

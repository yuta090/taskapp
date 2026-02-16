'use client'

import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { WikiPage, WikiPageVersion } from '@/types/database'
import {
  DEFAULT_WIKI_TITLE,
  DEFAULT_WIKI_TAGS,
  generateDefaultWikiBody,
  SPEC_TEMPLATES,
} from '@/lib/wiki/defaultTemplate'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'
import type { SupabaseClient } from '@supabase/supabase-js'

interface UseWikiPagesOptions {
  orgId: string
  spaceId: string
}

export interface CreateWikiPageInput {
  title: string
  tags?: string[]
}

export interface UpdateWikiPageInput {
  title?: string
  body?: string
  tags?: string[]
}

interface UseWikiPagesReturn {
  pages: WikiPage[]
  loading: boolean
  error: Error | null
  autoCreatedPageId: string | null
  fetchPages: () => Promise<void>
  createPage: (input: CreateWikiPageInput) => Promise<WikiPage>
  updatePage: (pageId: string, input: UpdateWikiPageInput) => Promise<void>
  deletePage: (pageId: string) => Promise<void>
  fetchPage: (pageId: string) => Promise<WikiPage | null>
  fetchVersions: (pageId: string) => Promise<WikiPageVersion[]>
  publishPage: (pageId: string, milestoneId: string) => Promise<void>
}

export function useWikiPages({ orgId, spaceId }: UseWikiPagesOptions): UseWikiPagesReturn {
  const queryClient = useQueryClient()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const defaultCreatedRef = useRef(false)

  const queryKey = ['wikiPages', orgId, spaceId] as const

  // ---------- Query: page list (without body) ----------
  const { data, isPending, error: queryError } = useQuery<{
    pages: WikiPage[]
    autoCreatedPageId: string | null
  }>({
    queryKey,
    queryFn: async () => {
      const { data: fetchedData, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('updated_at', { ascending: false })

      if (fetchError) throw fetchError

      const fetchedPages = (fetchedData || []) as WikiPage[]

      // Auto-create default pages on first access when wiki is empty
      if (fetchedPages.length === 0 && !defaultCreatedRef.current) {
        defaultCreatedRef.current = true

        // Check if space was created with a preset
        try {
          const { data: spaceData } = await (supabase as SupabaseClient)
            .from('spaces')
            .select('*')
            .eq('id', spaceId)
            .eq('org_id', orgId)
            .single()
          if (spaceData?.preset_genre != null) {
            return { pages: [], autoCreatedPageId: null }
          }
        } catch {
          return { pages: [], autoCreatedPageId: null }
        }

        try {
          const { data: authData } = await supabase.auth.getUser()
          const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID
          if (!userId) return { pages: [], autoCreatedPageId: null }

          // 1. Create spec pages
          const specRows = SPEC_TEMPLATES.map(spec => ({
            org_id: orgId,
            space_id: spaceId,
            title: spec.title,
            body: spec.generateBody(),
            tags: spec.tags,
            created_by: userId,
            updated_by: userId,
          }))

          const { data: specData } = await (supabase as SupabaseClient)
            .from('wiki_pages')
            .insert(specRows)
            .select('id, title')

          const specPages: SpecPageRef[] = (specData || []).map((s: { id: string; title: string }) => ({
            id: s.id,
            title: s.title,
          }))

          // 2. Create home page with auto-links to spec pages
          const defaultBody = generateDefaultWikiBody(orgId, spaceId, specPages)
          const { data: homeData, error: homeErr } = await (supabase as SupabaseClient)
            .from('wiki_pages')
            .insert({
              org_id: orgId,
              space_id: spaceId,
              title: DEFAULT_WIKI_TITLE,
              body: defaultBody,
              tags: DEFAULT_WIKI_TAGS,
              created_by: userId,
              updated_by: userId,
            })
            .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
            .single()

          if (!homeErr && homeData) {
            const { data: allPages } = await (supabase as SupabaseClient)
              .from('wiki_pages')
              .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
              .eq('org_id', orgId)
              .eq('space_id', spaceId)
              .order('updated_at', { ascending: false })

            return {
              pages: (allPages || []) as WikiPage[],
              autoCreatedPageId: (homeData as WikiPage).id,
            }
          }
        } catch {
          // Default page creation is non-critical
        }
      }

      return { pages: fetchedPages, autoCreatedPageId: null }
    },
    staleTime: 30_000,
    enabled: !!orgId && !!spaceId,
  })

  const pages = data?.pages ?? []

  // ---------- fetchPages: invalidate cache to trigger refetch ----------
  const fetchPages = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['wikiPages', orgId, spaceId] })
  }, [queryClient, orgId, spaceId])

  // ---------- fetchPage: on-demand full page (not cached in list query) ----------
  const fetchPage = useCallback(async (pageId: string): Promise<WikiPage | null> => {
    try {
      const { data: pageData, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .select('*')
        .eq('id', pageId)
        .eq('org_id', orgId)
        .single()

      if (fetchError) throw fetchError
      return pageData as WikiPage
    } catch {
      return null
    }
  }, [orgId, supabase])

  // ---------- fetchVersions: on-demand ----------
  const fetchVersions = useCallback(async (pageId: string): Promise<WikiPageVersion[]> => {
    try {
      const { data: versionsData, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_page_versions')
        .select('*')
        .eq('page_id', pageId)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      return (versionsData || []) as WikiPageVersion[]
    } catch {
      return []
    }
  }, [orgId, supabase])

  // ---------- Mutations ----------

  const createPage = useCallback(async (input: CreateWikiPageInput): Promise<WikiPage> => {
    const now = new Date().toISOString()
    const tempId = crypto.randomUUID()

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData?.user) {
      const demoUserId = process.env.NEXT_PUBLIC_DEMO_USER_ID
      if (process.env.NODE_ENV !== 'development' || !demoUserId) {
        throw new Error('ログインが必要です')
      }
    }
    const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID!

    const optimisticPage: WikiPage = {
      id: tempId,
      org_id: orgId,
      space_id: spaceId,
      title: input.title,
      body: '',
      tags: input.tags || [],
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    }

    // Optimistic update
    queryClient.setQueryData<{ pages: WikiPage[]; autoCreatedPageId: string | null }>(
      queryKey,
      (old) => ({
        pages: [optimisticPage, ...(old?.pages ?? [])],
        autoCreatedPageId: old?.autoCreatedPageId ?? null,
      })
    )

    try {
      const { data: created, error: createError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .insert({
          org_id: orgId,
          space_id: spaceId,
          title: input.title,
          body: '',
          tags: input.tags || [],
          created_by: userId,
          updated_by: userId,
        })
        .select('*')
        .single()

      if (createError) throw createError

      const createdPage = created as WikiPage
      queryClient.setQueryData<{ pages: WikiPage[]; autoCreatedPageId: string | null }>(
        queryKey,
        (old) => ({
          pages: (old?.pages ?? []).map(p => p.id === tempId ? createdPage : p),
          autoCreatedPageId: old?.autoCreatedPageId ?? null,
        })
      )
      return createdPage
    } catch (err) {
      // Revert optimistic update
      queryClient.setQueryData<{ pages: WikiPage[]; autoCreatedPageId: string | null }>(
        queryKey,
        (old) => ({
          pages: (old?.pages ?? []).filter(p => p.id !== tempId),
          autoCreatedPageId: old?.autoCreatedPageId ?? null,
        })
      )
      throw err instanceof Error ? err : new Error('Failed to create wiki page')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from orgId+spaceId already in deps
  }, [orgId, spaceId, supabase, queryClient])

  const updatePage = useCallback(async (pageId: string, input: UpdateWikiPageInput): Promise<void> => {
    // Capture previous state for rollback
    const previousData = queryClient.getQueryData<{
      pages: WikiPage[]
      autoCreatedPageId: string | null
    }>(queryKey)

    // Optimistic update
    queryClient.setQueryData<{ pages: WikiPage[]; autoCreatedPageId: string | null }>(
      queryKey,
      (old) => ({
        pages: (old?.pages ?? []).map(p =>
          p.id === pageId
            ? {
                ...p,
                title: input.title ?? p.title,
                body: input.body !== undefined ? input.body : p.body,
                tags: input.tags ?? p.tags,
                updated_at: new Date().toISOString(),
              }
            : p
        ),
        autoCreatedPageId: old?.autoCreatedPageId ?? null,
      })
    )

    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID

      const updateData: Record<string, unknown> = { updated_by: userId }
      if (input.title !== undefined) updateData.title = input.title
      if (input.body !== undefined) updateData.body = input.body
      if (input.tags !== undefined) updateData.tags = input.tags

      const { error: updateError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .update(updateData)
        .eq('id', pageId)
        .eq('org_id', orgId)

      if (updateError) throw updateError
    } catch (err) {
      // Revert optimistic update
      if (previousData) {
        queryClient.setQueryData(queryKey, previousData)
      }
      throw err instanceof Error ? err : new Error('Failed to update wiki page')
    }

    // Insert version snapshot if body changed (non-critical)
    if (input.body !== undefined) {
      try {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID
        if (userId) {
          const currentPage = previousData?.pages.find(p => p.id === pageId)
          await (supabase as SupabaseClient)
            .from('wiki_page_versions')
            .insert({
              org_id: orgId,
              page_id: pageId,
              title: input.title ?? currentPage?.title ?? '',
              body: input.body,
              created_by: userId,
            })
        }
      } catch {
        // Version snapshot failure is non-critical
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from orgId already in deps
  }, [orgId, supabase, queryClient])

  const deletePage = useCallback(async (pageId: string): Promise<void> => {
    const previousData = queryClient.getQueryData<{
      pages: WikiPage[]
      autoCreatedPageId: string | null
    }>(queryKey)

    // Optimistic update
    queryClient.setQueryData<{ pages: WikiPage[]; autoCreatedPageId: string | null }>(
      queryKey,
      (old) => ({
        pages: (old?.pages ?? []).filter(p => p.id !== pageId),
        autoCreatedPageId: old?.autoCreatedPageId ?? null,
      })
    )

    try {
      const { error: deleteError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .delete()
        .eq('id', pageId)
        .eq('org_id', orgId)

      if (deleteError) throw deleteError
    } catch (err) {
      // Revert optimistic update
      if (previousData) {
        queryClient.setQueryData(queryKey, previousData)
      }
      throw err instanceof Error ? err : new Error('Failed to delete wiki page')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from orgId already in deps
  }, [orgId, supabase, queryClient])

  const publishPage = useCallback(async (pageId: string, milestoneId: string): Promise<void> => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID

      const page = await fetchPage(pageId)
      if (!page) throw new Error('Page not found')

      const { error: pubError } = await (supabase as SupabaseClient)
        .from('wiki_page_publications')
        .insert({
          org_id: orgId,
          milestone_id: milestoneId,
          source_page_id: pageId,
          published_title: page.title,
          published_body: page.body,
          published_by: userId,
        })

      if (pubError) throw pubError
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to publish wiki page')
    }
  }, [orgId, supabase, fetchPage])

  return {
    pages,
    loading: isPending && !data,
    error: queryError,
    autoCreatedPageId: data?.autoCreatedPageId ?? null,
    fetchPages,
    createPage,
    updatePage,
    deletePage,
    fetchPage,
    fetchVersions,
    publishPage,
  }
}

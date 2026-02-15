'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
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
  fetchPages: () => Promise<string | null>
  createPage: (input: CreateWikiPageInput) => Promise<WikiPage>
  updatePage: (pageId: string, input: UpdateWikiPageInput) => Promise<void>
  deletePage: (pageId: string) => Promise<void>
  fetchPage: (pageId: string) => Promise<WikiPage | null>
  fetchVersions: (pageId: string) => Promise<WikiPageVersion[]>
  publishPage: (pageId: string, milestoneId: string) => Promise<void>
}

export function useWikiPages({ orgId, spaceId }: UseWikiPagesOptions): UseWikiPagesReturn {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabase = useMemo(() => createClient(), [])
  const defaultCreatedRef = useRef(false)

  // Returns the auto-created default page ID if one was created, null otherwise
  const fetchPages = useCallback(async (): Promise<string | null> => {
    setLoading(true)
    setError(null)

    try {
      // Fetch pages WITHOUT body for performance (body fetched on demand)
       
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('updated_at', { ascending: false })

      if (fetchError) throw fetchError

      const fetchedPages = (data || []) as WikiPage[]

      // Auto-create default pages on first access when wiki is empty
      // Creates: spec pages (API/DB/UI仕様書) → home page (with auto-links to specs)
      // Skip if space has a preset_genre set (content was seeded at creation or user chose blank)
      if (fetchedPages.length === 0 && !defaultCreatedRef.current) {
        defaultCreatedRef.current = true

        // Check if space was created with a preset — if so, skip auto-creation
        // preset_genre=NULL → legacy space (auto-create), non-NULL → preset applied or blank
        try {
           
          const { data: spaceData } = await (supabase as SupabaseClient)
            .from('spaces')
            .select('preset_genre')
            .eq('id', spaceId)
            .eq('org_id', orgId)
            .single()
          if (spaceData?.preset_genre != null) {
            // Preset applied or blank — do not auto-create wiki pages
            setPages([])
            return null
          }
        } catch {
          // Fail-closed: if we can't verify preset status, skip auto-creation
          // to avoid accidentally creating legacy pages in preset/blank spaces
          setPages([])
          return null
        }

        try {
          // Get auth user — requires authenticated user for FK constraint
          const { data: authData } = await supabase.auth.getUser()
          const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID
          if (!userId) return null

          // 1. Create spec pages first
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
            // Re-fetch all pages to get complete list
             
            const { data: allPages } = await (supabase as SupabaseClient)
              .from('wiki_pages')
              .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
              .eq('org_id', orgId)
              .eq('space_id', spaceId)
              .order('updated_at', { ascending: false })

            setPages((allPages || []) as WikiPage[])
            return (homeData as WikiPage).id
          }
        } catch {
          // Default page creation is non-critical — continue with empty list
        }
      }

      setPages(fetchedPages)
      return null
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch wiki pages'))
      return null
    } finally {
      setLoading(false)
    }
  }, [orgId, spaceId, supabase])

  const fetchPage = useCallback(async (pageId: string): Promise<WikiPage | null> => {
    try {
       
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .select('*')
        .eq('id', pageId)
        .eq('org_id', orgId)
        .single()

      if (fetchError) throw fetchError
      return data as WikiPage
    } catch {
      return null
    }
  }, [orgId, supabase])

  const createPage = useCallback(async (input: CreateWikiPageInput): Promise<WikiPage> => {
    const now = new Date().toISOString()
    const tempId = crypto.randomUUID()

    // Get auth user
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

    setPages(prev => [optimisticPage, ...prev])

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
      setPages(prev => prev.map(p => p.id === tempId ? createdPage : p))
      return createdPage
    } catch (err) {
      setPages(prev => prev.filter(p => p.id !== tempId))
      setError(err instanceof Error ? err : new Error('Failed to create wiki page'))
      throw err
    }
  }, [orgId, spaceId, supabase])

  const updatePage = useCallback(async (pageId: string, input: UpdateWikiPageInput): Promise<void> => {
    const prevPages = pages

    // Optimistic update
    setPages(prev => prev.map(p =>
      p.id === pageId
        ? {
            ...p,
            title: input.title ?? p.title,
            body: input.body !== undefined ? input.body : p.body,
            tags: input.tags ?? p.tags,
            updated_at: new Date().toISOString(),
          }
        : p
    ))

    try {
      // Get auth user
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
      setPages(prevPages)
      setError(err instanceof Error ? err : new Error('Failed to update wiki page'))
      throw err
    }

    // Insert version snapshot if body changed (separated to avoid rollback on version failure)
    if (input.body !== undefined) {
      try {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID
        if (userId) {
          const currentPage = prevPages.find(p => p.id === pageId)
           
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
        // Version snapshot failure is non-critical — page update already succeeded
      }
    }
  }, [pages, orgId, supabase])

  const deletePage = useCallback(async (pageId: string): Promise<void> => {
    const prevPages = pages

    setPages(prev => prev.filter(p => p.id !== pageId))

    try {
       
      const { error: deleteError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .delete()
        .eq('id', pageId)
        .eq('org_id', orgId)

      if (deleteError) throw deleteError
    } catch (err) {
      setPages(prevPages)
      setError(err instanceof Error ? err : new Error('Failed to delete wiki page'))
      throw err
    }
  }, [pages, orgId, supabase])

  const fetchVersions = useCallback(async (pageId: string): Promise<WikiPageVersion[]> => {
    try {
       
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_page_versions')
        .select('*')
        .eq('page_id', pageId)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      return (data || []) as WikiPageVersion[]
    } catch {
      return []
    }
  }, [orgId, supabase])

  const publishPage = useCallback(async (pageId: string, milestoneId: string): Promise<void> => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID

      // Fetch current page content for snapshot
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
      setError(err instanceof Error ? err : new Error('Failed to publish wiki page'))
      throw err
    }
  }, [orgId, supabase, fetchPage])

  return {
    pages,
    loading,
    error,
    fetchPages,
    createPage,
    updatePage,
    deletePage,
    fetchPage,
    fetchVersions,
    publishPage,
  }
}

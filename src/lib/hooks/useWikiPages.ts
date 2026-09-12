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
  /**
   * 編集できる人か（既定 false・安全側）。true のときだけ、Wiki が空なら
   * ホームページ・仕様書テンプレートの自動作成を行う。書ける場面だけ明示で渡す:
   * WikiPageClient は canEditSpaceContent の結果、TaskInspector は `!!onUpdate`。
   * TaskCreateSheet はページ一覧を読むだけ（仕様書リンクの選択肢）なので渡さない。
   */
  canEdit?: boolean
}

export interface CreateWikiPageInput {
  title: string
  tags?: string[]
}

export interface UpdateWikiPageInput {
  title?: string
  body?: string
  tags?: string[]
  /** 親ページ（フォルダ表示）。null で根に戻す。同一スペース外・循環はトリガーが例外で拒否する。 */
  parent_page_id?: string | null
  /** 紐づけるマイルストーン。null で解除。 */
  milestone_id?: string | null
  /** ピン留め時刻。null で解除、非 null で一覧の先頭に固定。 */
  pinned_at?: string | null
}

interface UseWikiPagesReturn {
  pages: WikiPage[]
  loading: boolean
  error: Error | null
  autoCreatedPageId: string | null
  fetchPages: () => Promise<void>
  createPage: (input: CreateWikiPageInput) => Promise<WikiPage>
  /**
   * baseUpdatedAt を渡すと保存の合言葉（楽観ロック）が働く: DB update に
   * `.eq('updated_at', baseUpdatedAt)` を足し、他の人（またはAI）が先に書き換えていて
   * 0行しか更新できなければ WikiConflictError を投げる。渡さない呼び出し（ページ情報
   * パネルの属性更新・版の復元）は今までどおり無条件で上書きする。
   * 戻り値の updatedAt は、次の保存の基準としてそのまま使えるDB上の最新値。
   * baseUpdatedAt を渡さない呼び出しで対象行が無かった（＝先に削除された等）ときは
   * null を返す（存在しない基準をでっち上げない。呼び出し側は fetchPage で null を
   * 確かめて「削除された」扱いにする）。
   */
  updatePage: (pageId: string, input: UpdateWikiPageInput, baseUpdatedAt?: string) => Promise<{ updatedAt: string | null }>
  deletePage: (pageId: string) => Promise<void>
  fetchPage: (pageId: string) => Promise<WikiPage | null>
  fetchVersions: (pageId: string) => Promise<WikiPageVersion[]>
  publishPage: (pageId: string, milestoneId: string) => Promise<void>
}

/**
 * Wiki 本文の保存で「基準の updated_at を渡したのに 0 行しか更新できなかった」ことを表す。
 * 0行の原因は主に「他の人（またはAI）がこのページを先に書き換えていた」（楽観ロックの失敗）
 * だが、それだけとは限らない。Postgres の UPDATE は RLS の条件に合わない・行そのものが
 * 既に削除されている場合も、エラーを返さず単に0行のまま成功する。つまり「ページが削除
 * された」場合もこの例外になり得る（updateError では区別できない）。呼び出し側は
 * fetchPage で読み直し、null なら「削除された」として扱う（"見せかけの競合"と同じ確認手順）。
 */
export class WikiConflictError extends Error {
  constructor(message = 'このページは、別の場所で更新されています') {
    super(message)
    this.name = 'WikiConflictError'
  }
}

// 読み込み中に毎レンダー新しい [] を返すと呼び出し側の useMemo が毎回無効化されるため共有定数にする
const EMPTY_PAGES: WikiPage[] = []

export function useWikiPages({ orgId, spaceId, canEdit = false }: UseWikiPagesOptions): UseWikiPagesReturn {
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
        .select('id, org_id, space_id, title, tags, parent_page_id, milestone_id, pinned_at, sort_order, created_by, updated_by, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('updated_at', { ascending: false })

      if (fetchError) throw fetchError

      const fetchedPages = (fetchedData || []) as WikiPage[]

      // Auto-create default pages on first access when wiki is empty.
      // 編集できない人（閲覧者・相手先）には行わない — 読んだだけで書き込みが走るのを防ぐ
      if (fetchedPages.length === 0 && !defaultCreatedRef.current && canEdit) {
        // Check if space was created with a preset
        try {
          const { data: spaceData } = await (supabase as SupabaseClient)
            .from('spaces')
            .select('*')
            .eq('id', spaceId)
            .eq('org_id', orgId)
            .single()
          if (spaceData?.preset_genre != null) {
            defaultCreatedRef.current = true
            return { pages: [], autoCreatedPageId: null }
          }
        } catch {
          // Fail-closed: skip auto-creation if preset check fails (retryable on next query)
          return { pages: [], autoCreatedPageId: null }
        }

        try {
          const { data: authData } = await supabase.auth.getUser()
          const demoUserId = process.env.NEXT_PUBLIC_DEMO_USER_ID
          const userId = authData?.user?.id || (process.env.NODE_ENV === 'development' ? demoUserId : null)
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
              // ホームページは常に一覧の先頭に固定しておく。DB へ渡す ISO 文字列なので
              // toISOString でよい（表示用の日付計算ではないため禁止事項に抵触しない）。
              pinned_at: new Date().toISOString(),
              created_by: userId,
              updated_by: userId,
            })
            .select('id, org_id, space_id, title, tags, parent_page_id, milestone_id, pinned_at, sort_order, created_by, updated_by, created_at, updated_at')
            .single()

          if (!homeErr && homeData) {
            defaultCreatedRef.current = true
            const { data: allPages } = await (supabase as SupabaseClient)
              .from('wiki_pages')
              .select('id, org_id, space_id, title, tags, parent_page_id, milestone_id, pinned_at, sort_order, created_by, updated_by, created_at, updated_at')
              .eq('org_id', orgId)
              .eq('space_id', spaceId)
              .order('updated_at', { ascending: false })

            return {
              pages: (allPages || []) as WikiPage[],
              autoCreatedPageId: (homeData as WikiPage).id,
            }
          }
        } catch {
          // Default page creation failed — leave ref false so retry is possible on next query
        }
      }

      return { pages: fetchedPages, autoCreatedPageId: null }
    },
    staleTime: 30_000,
    enabled: !!orgId && !!spaceId,
  })

  const pages = data?.pages ?? EMPTY_PAGES

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
      // 構造用の列（親ページ・マイルストーン・ピン留め・並び順）は
      // 新規作成時は必ず未設定。楽観更新の行も DB の初期値（NULL）に合わせる。
      parent_page_id: null,
      milestone_id: null,
      pinned_at: null,
      sort_order: null,
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

  const updatePage = useCallback(async (
    pageId: string,
    input: UpdateWikiPageInput,
    baseUpdatedAt?: string
  ): Promise<{ updatedAt: string }> => {
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
                // null は「未設定に戻す」なので ?? ではなく !== undefined で判定する
                parent_page_id: input.parent_page_id !== undefined ? input.parent_page_id : p.parent_page_id,
                milestone_id: input.milestone_id !== undefined ? input.milestone_id : p.milestone_id,
                pinned_at: input.pinned_at !== undefined ? input.pinned_at : p.pinned_at,
                updated_at: new Date().toISOString(),
              }
            : p
        ),
        autoCreatedPageId: old?.autoCreatedPageId ?? null,
      })
    )

    let updatedAt: string | null
    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id || process.env.NEXT_PUBLIC_DEMO_USER_ID

      const updateData: Record<string, unknown> = { updated_by: userId }
      if (input.title !== undefined) updateData.title = input.title
      if (input.body !== undefined) updateData.body = input.body
      if (input.tags !== undefined) updateData.tags = input.tags
      if (input.parent_page_id !== undefined) updateData.parent_page_id = input.parent_page_id
      if (input.milestone_id !== undefined) updateData.milestone_id = input.milestone_id
      if (input.pinned_at !== undefined) updateData.pinned_at = input.pinned_at

      let query = (supabase as SupabaseClient)
        .from('wiki_pages')
        .update(updateData)
        .eq('id', pageId)
        .eq('org_id', orgId)

      // baseUpdatedAt が渡されたときだけ楽観ロックの条件を足す（議事録の updateMinutes と同じ形）。
      // 渡されない呼び出し（ページ情報パネルの属性更新・版の復元）は当面そのまま無条件で上書きする。
      if (baseUpdatedAt !== undefined) {
        query = query.eq('updated_at', baseUpdatedAt)
      }

      // .select() は常に付ける。属性更新の呼び出しでも updated_at はトリガーで進むため、
      // これを取っておかないと「次の本文保存が持つ基準」が更新できず、自分の属性更新が
      // 原因で偽の競合を起こしてしまう。
      const { data: updated, error: updateError } = await query.select('id, updated_at')

      if (updateError) throw updateError

      const rows = (updated ?? []) as Array<{ id: string; updated_at: string }>
      if (baseUpdatedAt !== undefined && rows.length === 0) {
        // updateError が無いのに 0 行。基準の updated_at がズレていた（先に誰かが書き換えた）
        // ケースだけでなく、ページ自体が既に削除されていた場合もここに来る（区別しない。
        // どちらも「今のこの内容では上書きできない」という点で同じ扱いにしてよい）。
        throw new WikiConflictError()
      }
      // baseUpdatedAt を渡さない呼び出しで0行なら、更新できる行が無かった（削除済み等）。
      // 存在しない基準をでっち上げない — null をそのまま返し、呼び出し側の判断に委ねる。
      updatedAt = rows[0]?.updated_at ?? null
    } catch (err) {
      // Revert optimistic update
      if (previousData) {
        queryClient.setQueryData(queryKey, previousData)
      }
      if (err instanceof WikiConflictError) throw err
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

    return { updatedAt }
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

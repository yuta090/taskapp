'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookOpen, Plus, ArrowLeft } from '@phosphor-icons/react'
import { useInspector } from '@/components/layout'
import { WikiPageRow } from '@/components/wiki/WikiPageRow'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import { WikiCreateSheet } from '@/components/wiki/WikiCreateSheet'
import { WikiEditorDynamic } from '@/components/wiki/WikiEditorDynamic'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import type { WikiPage, WikiPageVersion } from '@/types/database'

interface WikiPageClientProps {
  orgId: string
  spaceId: string
}

export function WikiPageClient({ orgId, spaceId }: WikiPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [activePage, setActivePage] = useState<WikiPage | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)

  const {
    pages,
    loading,
    fetchPages,
    createPage,
    updatePage,
    deletePage,
    fetchPage,
    fetchVersions,
  } = useWikiPages({ orgId, spaceId })

  const projectBasePath = `/${orgId}/project/${spaceId}/wiki`
  const selectedPageId = searchParams.get('page')

  useEffect(() => {
    const init = async () => {
      const defaultPageId = await fetchPages()
      // Auto-navigate to default page when it's first created
      if (defaultPageId && !selectedPageId) {
        updateQuery({ page: defaultPageId })
      }
    }
    void init()
  }, [fetchPages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup inspector on unmount
  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      })
      const query = params.toString()
      router.replace(query ? `${projectBasePath}?${query}` : projectBasePath)
    },
    [router, projectBasePath, searchParams]
  )

  // Load active page content when selected
  useEffect(() => {
    if (!selectedPageId) {
      setActivePage(null)
      setInspector(null)
      return
    }

    // Clear timers from previous page
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSaveStatus('idle')

    let cancelled = false
    const load = async () => {
      const page = await fetchPage(selectedPageId)
      if (!cancelled) {
        setActivePage(page) // null if not found — clears stale state
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedPageId, fetchPage, setInspector])

  // Set inspector when active page changes
  useEffect(() => {
    if (!activePage) {
      setInspector(null)
      return
    }

    const handleUpdate = async (updates: { title?: string; tags?: string[] }) => {
      await updatePage(activePage.id, updates)
      // Re-fetch page for fresh data
      const fresh = await fetchPage(activePage.id)
      if (fresh) setActivePage(fresh)
    }

    const handleDelete = async () => {
      await deletePage(activePage.id)
      updateQuery({ page: null })
    }

    const handleRestoreVersion = (version: WikiPageVersion) => {
      // Update the page body with the version's body
      updatePage(activePage.id, { body: version.body, title: version.title }).then(async () => {
        const fresh = await fetchPage(activePage.id)
        if (fresh) setActivePage(fresh)
      })
    }

    setInspector(
      <WikiPageInspector
        page={activePage}
        onClose={() => updateQuery({ page: null })}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onFetchVersions={fetchVersions}
        onRestoreVersion={handleRestoreVersion}
      />
    )
  }, [activePage, setInspector, updatePage, deletePage, fetchPage, fetchVersions, updateQuery])

  const handleSelectPage = (pageId: string) => {
    updateQuery({ page: pageId })
  }

  const handleCreatePage = async (data: { title: string; tags?: string[] }) => {
    const created = await createPage(data)
    updateQuery({ page: created.id })
  }

  const handleEditorChange = useCallback((content: string) => {
    if (!activePage) return

    // Clear existing timers
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    setSaveStatus('saving')

    saveTimerRef.current = setTimeout(async () => {
      try {
        await updatePage(activePage.id, { body: content })
        setSaveStatus('saved')
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
    }, 1500)
  }, [activePage, updatePage])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const handleBackToList = () => {
    updateQuery({ page: null })
  }

  // Editor view
  if (selectedPageId && activePage) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToList}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="text-lg" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900 truncate">{activePage.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                保存中...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-500">保存済み</span>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-4">
            <WikiEditorDynamic
              key={activePage.id}
              initialContent={activePage.body || undefined}
              onChange={handleEditorChange}
              editable={true}
              orgId={orgId}
              spaceId={spaceId}
            />
          </div>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <BookOpen className="text-gray-500" />
            <span className="font-medium text-gray-900">Wiki</span>
          </div>
        </div>
        <button
          onClick={() => setIsCreateSheetOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
        >
          <Plus className="text-base" />
          新規ページ
        </button>
      </div>

      {/* Page List */}
      <div className="flex-1 overflow-y-auto">
        {loading && pages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-gray-400">読み込み中...</span>
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="text-4xl text-gray-300 mb-3" />
            <p className="text-gray-500 mb-1">Wikiページがありません</p>
            <p className="text-sm text-gray-400">「新規ページ」からページを作成してください</p>
          </div>
        ) : (
          <div>
            {pages.map(page => (
              <WikiPageRow
                key={page.id}
                page={page}
                isSelected={selectedPageId === page.id}
                onClick={() => handleSelectPage(page.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Sheet */}
      <WikiCreateSheet
        isOpen={isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        onSubmit={handleCreatePage}
      />
    </div>
  )
}

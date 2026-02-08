'use client'

import { useState } from 'react'
import { BookOpen, ArrowLeft } from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'
import { WikiEditorDynamic } from '@/components/wiki/WikiEditorDynamic'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface PublishedWikiPage {
  id: string
  title: string
  body: string
  publishedAt: string
}

interface PortalWikiClientProps {
  currentProject: Project
  projects: Project[]
  wikiPages: PublishedWikiPage[]
  actionCount?: number
}

export function PortalWikiClient({
  currentProject,
  projects,
  wikiPages,
  actionCount = 0,
}: PortalWikiClientProps) {
  const [selectedPage, setSelectedPage] = useState<PublishedWikiPage | null>(null)

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
  }

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          {selectedPage ? (
            <div>
              <button
                onClick={() => setSelectedPage(null)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors"
              >
                <ArrowLeft className="text-base" />
                Wiki一覧に戻る
              </button>
              <h1 className="text-2xl font-bold text-gray-900">{selectedPage.title}</h1>
              <p className="mt-1 text-sm text-gray-400">
                公開日: {formatDate(selectedPage.publishedAt)}
              </p>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Wiki</h1>
              <p className="mt-1 text-sm text-gray-600">
                プロジェクトのドキュメント・仕様書
              </p>
            </div>
          )}

          {/* Content */}
          {selectedPage ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <WikiEditorDynamic
                key={selectedPage.id}
                initialContent={selectedPage.body || undefined}
                editable={false}
              />
            </div>
          ) : wikiPages.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <BookOpen className="text-4xl text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">公開されたWikiページはまだありません</p>
            </div>
          ) : (
            <div className="space-y-3">
              {wikiPages.map(page => (
                <div
                  key={page.id}
                  onClick={() => setSelectedPage(page)}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900">{page.title}</h3>
                    <span className="text-xs text-gray-400 flex-shrink-0 ml-4">
                      {formatDate(page.publishedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}

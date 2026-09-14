'use client'

import { useState } from 'react'
import { WikiPageLinkPicker } from '@/components/task/WikiPageLinkPicker'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import type { TaskLineDraft } from '@/lib/minutes/taskLine'
import type { WikiPage } from '@/types/database'

const SPEC_TAG = '仕様書'

interface MinutesTaskLinePanelProps {
  orgId: string
  spaceId: string
  /** 「入れる」を押したとき。本文に1行入れて、パネルを閉じる */
  onInsert: (draft: TaskLineDraft) => void
  onClose: () => void
}

/**
 * 「タスクにする行」を作るパネル。
 *
 * 議事録の行は**書き方**でタスクの中身が決まるが、その書き方（期限の形・資料の差し込み方）を
 * 覚えてもらうのは無理がある。ここで選んでもらったものから、必ず読み取れる1行を組み立てる。
 *
 * 資料の欄は、タスクの詳細画面と同じ部品を使う（探して選ぶ／無ければその場で作る）。
 */
export function MinutesTaskLinePanel({ orgId, spaceId, onInsert, onClose }: MinutesTaskLinePanelProps) {
  const {
    pages: wikiPages,
    loading: wikiPagesLoading,
    error: wikiPagesError,
    createPage,
  } = useWikiPages({ orgId, spaceId, canEdit: true })

  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [page, setPage] = useState<Pick<WikiPage, 'id' | 'title' | 'tags'> | null>(null)

  const isSpec = !!page?.tags?.includes(SPEC_TAG)
  const canInsert = title.trim() !== ''

  const handleSelect = (pageId: string | null, selected?: Pick<WikiPage, 'id' | 'title' | 'tags'>) => {
    if (pageId === null) {
      setPage(null)
      return
    }
    // 作った直後のページは一覧にまだ無いので、渡されたほうを先に見る
    setPage(selected ?? wikiPages.find((p) => p.id === pageId) ?? null)
  }

  const handleInsert = () => {
    if (!canInsert) return
    onInsert({ title, due: due || undefined, page: page ? { id: page.id, title: page.title } : undefined })
    setTitle('')
    setDue('')
    setPage(null)
  }

  return (
    <div
      data-testid="minutes-task-line-panel"
      className="mt-2 rounded border border-gray-200 bg-surface p-3 space-y-3"
    >
      <p className="text-xs text-gray-500">
        チェックの付いた行として入ります。この行が「タスク化」の候補になります。
      </p>

      <div>
        <label htmlFor="minutes-task-line-title" className="block text-xs font-medium text-gray-700 mb-1">
          やること
        </label>
        <input
          id="minutes-task-line-title"
          data-testid="minutes-task-line-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canInsert) {
              e.preventDefault()
              handleInsert()
            }
            if (e.key === 'Escape') onClose()
          }}
          placeholder="例: 見積を出す"
          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
        />
      </div>

      <div>
        <label htmlFor="minutes-task-line-due" className="block text-xs font-medium text-gray-700 mb-1">
          期限（任意）
        </label>
        <input
          id="minutes-task-line-due"
          data-testid="minutes-task-line-due"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded border border-gray-200 px-2 py-1 text-sm"
        />
      </div>

      <div>
        <span className="block text-xs font-medium text-gray-700 mb-1">資料（任意）</span>
        <WikiPageLinkPicker
          pages={wikiPages}
          value={page?.id ?? null}
          loading={wikiPagesLoading}
          // 手元に一覧が残っていれば、裏の取り直しに失敗しても探す・作るはそのまま使える
          loadError={!!wikiPagesError && wikiPages.length === 0}
          onSelect={handleSelect}
          onCreate={(newTitle) => createPage({ title: newTitle })}
          testId="minutes-task-line-wiki-page"
        />
        {isSpec && (
          <p data-testid="minutes-task-line-spec-note" className="mt-1 text-xs text-gray-500">
            このページは「仕様書として扱う」になっています。決まるまで完了できない「決定事項のタスク」になります。
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="minutes-task-line-submit"
          disabled={!canInsert}
          onClick={handleInsert}
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          入れる
        </button>
        <button
          type="button"
          data-testid="minutes-task-line-cancel"
          onClick={onClose}
          className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          やめる
        </button>
      </div>
    </div>
  )
}

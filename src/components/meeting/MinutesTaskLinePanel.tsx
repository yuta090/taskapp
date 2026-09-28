'use client'

import { useEffect, useRef, useState } from 'react'
import { WikiPageLinkPicker } from '@/components/task/WikiPageLinkPicker'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
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
    // canEdit は渡さない。**渡すと「Wiki が空なら既定のページを自動で作る」が動く**
    // （useWikiPages の中の仕掛け）。会議中にこのパネルを開いただけで、誰も頼んで
    // いないページが数枚できてしまう。ここは探す・作るだけで、自動作成は要らない
  } = useWikiPages({ orgId, spaceId })

  // 担当者とマイルストーンの選択肢。どちらもタスクの新規作成シートと同じ一覧を使う。
  // useSpaceMembers の `loading` は**いつも false**（中で既定の [] が入るため）なので、
  // 一度も取れていないことは `isPending` で見る。これを取り違えると、一覧がまだ無い人には
  // 空の「未設定」だけが出て「担当者が選べない」ように見える
  const { members, isPending: membersPending } = useSpaceMembers(spaceId)
  const { milestones, loading: milestonesLoading } = useMilestones({ spaceId })

  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [page, setPage] = useState<Pick<WikiPage, 'id' | 'title' | 'tags'> | null>(null)
  const [assigneeId, setAssigneeId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')

  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)

  /**
   * このパネルは**本文のいちばん下**に出る。長い議事録の途中で「/」から呼ぶと
   * 画面の外に開くので、「選んでも何も起きない」ように見えていた（ユーザー報告）。
   * 開いた側から画面を寄せて、そのまま打ち始められるところまで面倒を見る。
   * 開いたときだけ作られる部品なので、1回だけでよい。
   */
  useEffect(() => {
    // jsdom のように scrollIntoView を持たない場合もある（useSpotlightRect と同じ守り）
    panelRef.current?.scrollIntoView?.({ block: 'nearest' })
    titleRef.current?.focus()
  }, [])

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
    // 名前も一緒に渡す。本文の印に名前が入っていないと、開いた人が誰のことか分からない
    const member = members.find((m) => m.id === assigneeId)
    const milestone = milestones.find((m) => m.id === milestoneId)
    onInsert({
      title,
      due: due || undefined,
      page: page ? { id: page.id, title: page.title } : undefined,
      assignee: member ? { id: member.id, name: member.displayName } : undefined,
      milestone: milestone ? { id: milestone.id, name: milestone.name } : undefined,
    })
    setTitle('')
    setDue('')
    setPage(null)
    setAssigneeId('')
    setMilestoneId('')
  }

  return (
    <div
      ref={panelRef}
      data-testid="minutes-task-line-panel"
      // 開いたまま「PDFで保存」を押しても紙には出さない（押すためのパネル）
      data-print-hide
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
          ref={titleRef}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="minutes-task-line-assignee" className="block text-xs font-medium text-gray-700 mb-1">
            担当者（任意）
          </label>
          <select
            id="minutes-task-line-assignee"
            data-testid="minutes-task-line-assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            disabled={membersPending}
            className="w-full rounded border border-gray-200 bg-surface px-2 py-1 text-sm"
          >
            <option value="">{membersPending ? '読み込み中...' : '未設定'}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="minutes-task-line-milestone" className="block text-xs font-medium text-gray-700 mb-1">
            マイルストーン（任意）
          </label>
          <select
            id="minutes-task-line-milestone"
            data-testid="minutes-task-line-milestone"
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
            disabled={milestonesLoading}
            className="w-full rounded border border-gray-200 bg-surface px-2 py-1 text-sm"
          >
            <option value="">{milestonesLoading ? '読み込み中...' : '未設定'}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
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

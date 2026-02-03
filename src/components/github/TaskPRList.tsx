'use client'

import { useState } from 'react'
import { GithubLogo, Plus, X } from '@phosphor-icons/react'
import { useTaskGitHubLinks, useSpacePullRequests, useManualLinkPR, useUnlinkPR } from '@/lib/hooks'
import { isGitHubConfigured } from '@/lib/github/config'
import { PRBadge } from './PRBadge'

interface TaskPRListProps {
  taskId: string
  spaceId: string
  orgId: string
  readOnly?: boolean
}

export function TaskPRList({ taskId, spaceId, orgId, readOnly = false }: TaskPRListProps) {
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [selectedPRId, setSelectedPRId] = useState<string>('')

  // GitHub未設定の場合はフックを呼ばずに早期リターン
  const githubEnabled = isGitHubConfigured()

  const { data: links = [], isLoading } = useTaskGitHubLinks(githubEnabled ? taskId : undefined)
  const { data: spacePRs = [] } = useSpacePullRequests(githubEnabled ? spaceId : undefined)
  const linkPR = useManualLinkPR()
  const unlinkPR = useUnlinkPR()

  // GitHub未設定の場合は表示しない
  if (!githubEnabled) {
    return null
  }

  // 未リンクのPRをフィルタ
  const linkedPRIds = links.map(l => l.github_pr_id)
  const availablePRs = spacePRs.filter(pr => !linkedPRIds.includes(pr.id))

  const handleLink = async () => {
    if (!selectedPRId) return

    try {
      await linkPR.mutateAsync({
        taskId,
        githubPrId: selectedPRId,
        orgId,
      })
      setSelectedPRId('')
      setShowLinkDialog(false)
    } catch (err) {
      console.error('Failed to link PR:', err)
      alert('PRの紐付けに失敗しました')
    }
  }

  const handleUnlink = async (linkId: string) => {
    if (!confirm('このPRの紐付けを解除しますか？')) return

    try {
      await unlinkPR.mutateAsync({ linkId, taskId })
    } catch (err) {
      console.error('Failed to unlink PR:', err)
      alert('紐付けの解除に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <GithubLogo />
          <span>関連PR</span>
        </div>
        <div className="text-xs text-gray-400">読み込み中...</div>
      </div>
    )
  }

  // PRがなく、利用可能なPRもない場合は表示しない
  if (links.length === 0 && availablePRs.length === 0 && readOnly) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <GithubLogo />
          <span>関連PR</span>
          {links.length > 0 && (
            <span className="px-1.5 py-0.5 text-2xs bg-gray-100 rounded">
              {links.length}
            </span>
          )}
        </div>
        {!readOnly && availablePRs.length > 0 && !showLinkDialog && (
          <button
            onClick={() => setShowLinkDialog(true)}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="PRを紐付け"
          >
            <Plus className="text-sm" />
          </button>
        )}
      </div>

      {/* PR List */}
      {links.length > 0 ? (
        <div className="space-y-2">
          {links.map((link) => {
            const pr = link.github_pull_requests
            if (!pr) return null

            return (
              <div key={link.id} className="relative group">
                <PRBadge
                  state={pr.pr_state}
                  prNumber={pr.pr_number}
                  prUrl={pr.pr_url}
                  title={pr.pr_title}
                  repoName={pr.github_repositories?.full_name || ''}
                  authorLogin={pr.author_login || undefined}
                  additions={pr.additions}
                  deletions={pr.deletions}
                  updatedAt={pr.updated_at}
                />
                {!readOnly && (
                  <button
                    onClick={() => handleUnlink(link.id)}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 bg-white rounded opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    title="紐付けを解除"
                  >
                    <X className="text-xs" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : !showLinkDialog ? (
        <div className="text-xs text-gray-400">
          PRが紐付けられていません
        </div>
      ) : null}

      {/* Link Dialog */}
      {showLinkDialog && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
          <div className="text-xs font-medium text-gray-600">PRを紐付け</div>
          <select
            value={selectedPRId}
            onChange={(e) => setSelectedPRId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">PRを選択...</option>
            {availablePRs.map((pr) => (
              <option key={pr.id} value={pr.id}>
                #{pr.pr_number} {pr.pr_title.slice(0, 50)}
                {pr.pr_title.length > 50 ? '...' : ''}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowLinkDialog(false)
                setSelectedPRId('')
              }}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
            >
              キャンセル
            </button>
            <button
              onClick={handleLink}
              disabled={!selectedPRId || linkPR.isPending}
              className="px-2 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded"
            >
              {linkPR.isPending ? '紐付け中...' : '紐付け'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { GithubLogo, Plus, X, ArrowSquareOut } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/shared'
import {
  useTaskGitHubIssues,
  useSpaceGitHubRepos,
  useIssueLinkCandidates,
  useManualLinkIssue,
  useUnlinkIssue,
} from '@/lib/hooks'
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue'
import { isGitHubConfigured } from '@/lib/github/enabled'
import type { GitHubIssue, TaskGitHubIssueLink } from '@/lib/github/types'

interface TaskIssueListProps {
  taskId: string
  spaceId: string
  orgId: string
  readOnly?: boolean
}

// FilesPageClient と同じ 350ms（打鍵の切れ目を待ってから問い合わせる）
const SEARCH_DEBOUNCE_MS = 350

// GITHUB_ISSUES_LINK_SPEC.md §8: 開いている／完了／見送り（state_reason が not_planned）の3状態
function issueStateLabel(issue: GitHubIssue): string {
  if (issue.state === 'open') return '開いている'
  if (issue.state_reason === 'not_planned') return '見送り'
  return '完了'
}

function issueStateStyle(issue: GitHubIssue): string {
  if (issue.state === 'open') return 'bg-green-50 border-green-200 text-green-600'
  if (issue.state_reason === 'not_planned') return 'bg-gray-50 border-gray-200 text-gray-500'
  return 'bg-indigo-50 border-indigo-200 text-indigo-ink'
}

/**
 * 「N件中M件完了」の数え方。task_github_issue_rollups を別に取らず、この一覧に
 * 含まれる Issue の状態からその場で数える（表示速度レビューでの是正・§useTaskGitHubIssues 参照）。
 * N=紐づいた全件、M=closed かつ state_reason が not_planned 以外
 */
function summarizeIssueLinks(links: TaskGitHubIssueLink[]): { total: number; completed: number } {
  let total = 0
  let completed = 0
  for (const link of links) {
    const issue = link.github_issues
    if (!issue) continue
    total += 1
    if (issue.state === 'closed' && issue.state_reason !== 'not_planned') completed += 1
  }
  return { total, completed }
}

export function TaskIssueList({ taskId, spaceId, orgId, readOnly = false }: TaskIssueListProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [showLinkPanel, setShowLinkPanel] = useState(false)
  const [search, setSearch] = useState('')

  // GitHub未設定の場合はフックを呼ばずに早期リターン
  const githubEnabled = isGitHubConfigured()

  const { data, isLoading } = useTaskGitHubIssues(githubEnabled ? taskId : undefined)
  const links = data?.links ?? []

  // リポジトリ一覧は既存の useSpaceGitHubRepos を使い回す（space_github_repos を別に問い合わせない）。
  // 紐付け欄を開いたときだけ取得する
  const { data: spaceRepos = [] } = useSpaceGitHubRepos(
    githubEnabled && showLinkPanel ? spaceId : undefined
  )
  const repoIds = spaceRepos.map((r) => r.github_repo_id)

  // 打鍵ごとに問い合わせないよう、落ち着いた値で検索する（FilesPageClient と同じ 350ms）
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  const { data: candidates = [], isLoading: candidatesLoading } = useIssueLinkCandidates(
    repoIds,
    debouncedSearch
  )
  const linkIssue = useManualLinkIssue()
  const unlinkIssue = useUnlinkIssue()

  // GitHub未設定の場合は表示しない
  if (!githubEnabled) {
    return null
  }

  const linkedIssueIds = links.map((l) => l.github_issue_id)
  const availableCandidates = candidates.filter((issue) => !linkedIssueIds.includes(issue.id))

  const handleLink = async (issue: GitHubIssue) => {
    try {
      await linkIssue.mutateAsync({ taskId, issue, orgId })
      setSearch('')
      setShowLinkPanel(false)
      toast.success('Issueを紐付けました')
    } catch (err) {
      console.error('Failed to link issue:', err)
      toast.error('Issueの紐付けに失敗しました')
    }
  }

  const handleUnlink = async (linkId: string) => {
    const ok = await confirm({
      title: 'Issue紐付けを解除',
      message: 'このIssueの紐付けを解除しますか？',
      confirmLabel: '解除',
      variant: 'danger',
    })
    if (!ok) return

    try {
      await unlinkIssue.mutateAsync({ linkId, taskId })
      toast.success('Issueの紐付けを解除しました')
    } catch (err) {
      console.error('Failed to unlink issue:', err)
      toast.error('紐付けの解除に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="task-issue-list">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <GithubLogo />
          <span>関連Issue</span>
        </div>
        <div className="text-xs text-gray-400">読み込み中...</div>
      </div>
    )
  }

  // Issueがなく、readOnly（表示専用）なら何も出さない（TaskPRList と同じ条件）
  if (links.length === 0 && readOnly) {
    return null
  }

  const { total, completed } = summarizeIssueLinks(links)

  return (
    <div className="space-y-2" data-testid="task-issue-list">
      {ConfirmDialog}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <GithubLogo />
          <span>関連Issue</span>
          {total > 0 && (
            <span
              className="px-1.5 py-0.5 text-2xs bg-gray-100 rounded"
              data-testid="task-issue-rollup-badge"
            >
              {total}件中{completed}件完了
            </span>
          )}
        </div>
        {!readOnly && !showLinkPanel && (
          <button
            onClick={() => setShowLinkPanel(true)}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="Issueを紐付け"
            data-testid="task-issue-link-button"
          >
            <Plus className="text-sm" />
          </button>
        )}
      </div>

      {/* Issue一覧 */}
      {links.length > 0 ? (
        <div className="space-y-2">
          {links.map((link) => {
            const issue = link.github_issues
            if (!issue) return null

            return (
              <div key={link.id} className="relative group" data-testid={`task-issue-row-${issue.issue_number}`}>
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block p-3 rounded-lg border hover:opacity-90 transition-opacity ${issueStateStyle(issue)}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">#{issue.issue_number}</span>
                    <span className="text-xs">{issueStateLabel(issue)}</span>
                    <ArrowSquareOut className="text-gray-400 text-xs" />
                  </div>
                  <p className="text-sm text-gray-800 font-medium truncate mt-0.5">{issue.title}</p>
                  {issue.assignee_logins.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">担当: {issue.assignee_logins.join(', ')}</p>
                  )}
                </a>
                {!readOnly && (
                  <button
                    onClick={() => handleUnlink(link.id)}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 bg-surface rounded opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    title="紐付けを解除"
                    data-testid={`task-issue-unlink-${issue.issue_number}`}
                  >
                    <X className="text-xs" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : !showLinkPanel ? (
        <div className="text-xs text-gray-400">Issueが紐付けられていません</div>
      ) : null}

      {/* 紐付け欄（モーダルにせず、その場で開く） */}
      {showLinkPanel && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
          <div className="text-xs font-medium text-gray-600">Issueを紐付け</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="番号またはタイトルで検索"
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="task-issue-search-input"
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {candidatesLoading ? (
              <div className="text-xs text-gray-400 px-2 py-1">読み込み中...</div>
            ) : availableCandidates.length === 0 ? (
              <div className="text-xs text-gray-400 px-2 py-1">該当するIssueがありません</div>
            ) : (
              availableCandidates.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => handleLink(issue)}
                  disabled={linkIssue.isPending}
                  className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
                  data-testid={`task-issue-candidate-${issue.issue_number}`}
                >
                  #{issue.issue_number} {issue.title.slice(0, 50)}
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                setShowLinkPanel(false)
                setSearch('')
              }}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

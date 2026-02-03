'use client'

import { useState } from 'react'
import { GithubLogo, Link as LinkIcon, Trash, Plus, ArrowSquareOut, CheckCircle } from '@phosphor-icons/react'
import {
  useGitHubInstallation,
  useGitHubRepositories,
  useSpaceGitHubRepos,
  useLinkRepoToSpace,
  useUnlinkRepoFromSpace,
} from '@/lib/hooks'
import { getGitHubInstallUrl, isGitHubConfigured } from '@/lib/github/config'

interface GitHubSettingsProps {
  orgId: string
  spaceId: string
}

export function GitHubSettings({ orgId, spaceId }: GitHubSettingsProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('')

  // Hooks
  const { data: installation, isLoading: loadingInstallation } = useGitHubInstallation(orgId)
  const { data: repositories = [], isLoading: loadingRepos } = useGitHubRepositories(orgId)
  const { data: linkedRepos = [], isLoading: loadingLinked } = useSpaceGitHubRepos(spaceId)
  const linkRepo = useLinkRepoToSpace()
  const unlinkRepo = useUnlinkRepoFromSpace()

  // GitHub App が設定されているか確認
  const isConfigured = isGitHubConfigured()

  // 未連携のリポジトリをフィルタ
  const linkedRepoIds = linkedRepos.map(lr => lr.github_repo_id)
  const availableRepos = repositories.filter(r => !linkedRepoIds.includes(r.id))

  const handleLinkRepo = async () => {
    if (!selectedRepoId) return

    try {
      await linkRepo.mutateAsync({
        spaceId,
        githubRepoId: selectedRepoId,
      })
      setSelectedRepoId('')
    } catch (err) {
      console.error('Failed to link repository:', err)
      alert('リポジトリの連携に失敗しました')
    }
  }

  const handleUnlinkRepo = async (linkId: string) => {
    if (!confirm('このリポジトリの連携を解除しますか？')) return

    try {
      await unlinkRepo.mutateAsync({
        linkId,
        spaceId,
      })
    } catch (err) {
      console.error('Failed to unlink repository:', err)
      alert('連携の解除に失敗しました')
    }
  }

  // GitHub App 未設定
  if (!isConfigured) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <GithubLogo className="text-lg" weight="bold" />
          <h3 className="font-medium">GitHub連携</h3>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-600">
            GitHub連携を利用するには、環境変数の設定が必要です。
          </p>
          <p className="text-xs text-gray-500 mt-2">
            詳しくはドキュメントを参照してください。
          </p>
        </div>
      </div>
    )
  }

  const isLoading = loadingInstallation || loadingRepos || loadingLinked

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <GithubLogo className="text-lg" weight="bold" />
        <h3 className="font-medium">GitHub連携</h3>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-gray-500">読み込み中...</div>
      ) : !installation ? (
        // GitHub App 未インストール
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-gray-600">
            GitHubと連携して、PRとタスクを自動で紐付けできます。
          </p>
          <a
            href={getGitHubInstallUrl(orgId, `/settings/integrations/github`)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <GithubLogo className="text-lg" />
            GitHubと連携する
            <ArrowSquareOut className="text-sm" />
          </a>
        </div>
      ) : (
        // GitHub App インストール済み
        <div className="space-y-4">
          {/* 連携ステータス */}
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="text-green-500" weight="fill" />
            <span className="text-gray-600">
              <strong>{installation.account_login}</strong> と連携中
            </span>
            <a
              href={`https://github.com/settings/installations`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline ml-2"
            >
              設定を変更
              <ArrowSquareOut className="inline ml-0.5 text-xs" />
            </a>
          </div>

          {/* 連携済みリポジトリ */}
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">
              このプロジェクトに連携されたリポジトリ
            </div>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
              {linkedRepos.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-500 text-center">
                  リポジトリが連携されていません
                </div>
              ) : (
                linkedRepos.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                  >
                    <GithubLogo className="text-gray-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {link.github_repositories?.full_name || 'Unknown'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {link.sync_prs && 'PR同期: ON'}
                      </div>
                    </div>
                    <a
                      href={`https://github.com/${link.github_repositories?.full_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                      title="GitHubで開く"
                    >
                      <ArrowSquareOut className="text-sm" />
                    </a>
                    <button
                      onClick={() => handleUnlinkRepo(link.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="連携を解除"
                    >
                      <Trash className="text-sm" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* リポジトリ追加 */}
          {availableRepos.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-medium text-gray-500 mb-2">
                リポジトリを追加
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <select
                    value={selectedRepoId}
                    onChange={(e) => setSelectedRepoId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">リポジトリを選択...</option>
                    {availableRepos.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.full_name}
                        {repo.is_private && ' (Private)'}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleLinkRepo}
                  disabled={!selectedRepoId || linkRepo.isPending}
                  className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <Plus className="text-sm" />
                  {linkRepo.isPending ? '追加中...' : '追加'}
                </button>
              </div>
            </div>
          )}

          {/* 利用方法 */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm">
            <h4 className="font-medium text-gray-700 mb-2">
              <LinkIcon className="inline mr-1" />
              タスクとPRの紐付け方法
            </h4>
            <p className="text-gray-600 mb-2">
              PRのタイトルまたは本文にタスクIDを含めると、自動的に紐付けられます。
            </p>
            <div className="bg-gray-900 text-gray-100 p-3 rounded-lg text-xs font-mono">
              # 対応フォーマット<br />
              feat: ログイン修正 <span className="text-green-400">#TP-042</span><br />
              fix: <span className="text-green-400">[TP-123]</span> バグ修正<br />
              <span className="text-green-400">TP-001</span> 対応
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

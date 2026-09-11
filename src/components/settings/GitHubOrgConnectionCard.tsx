'use client'

import { CheckCircle, ArrowSquareOut, GithubLogo } from '@phosphor-icons/react'
import { useGitHubInstallation, useGitHubConnection } from '@/lib/hooks/useGitHub'
import { useUserName } from '@/lib/hooks/useSpaceMembers'

interface GitHubOrgConnectionCardProps {
  orgId: string
  /** 組織のオーナーか（接続を始められるのはオーナーだけ） */
  isOwner: boolean
}

/**
 * 組織設定(外部連携)の GitHub カードの中身。
 *
 * リポジトリ一覧・リポジトリ名は GitHub を接続した本人（github_installations.created_by）
 * にしか見えない（RLS）。useGitHubInstallation は本人以外には常に null を返すため、
 * それだけで判定すると「実際は接続済みなのに未接続に見える」紛らわしい表示になる。
 * 社内メンバーに connected/connected_by/is_me を返す useGitHubConnection（RPC）で
 * 出し分ける。
 */
export function GitHubOrgConnectionCard({ orgId, isOwner }: GitHubOrgConnectionCardProps) {
  const { data: installation, isPending: pendingInstallation } = useGitHubInstallation(orgId)
  const { data: connection, isPending: pendingConnection } = useGitHubConnection(orgId)
  // 本人のときは自分の名前を出す必要が無いので問い合わせない
  const { name: connectedByName } = useUserName(
    connection && !connection.isMe ? connection.connectedBy : null
  )

  // isLoading（実際に通信中）ではなく isPending（まだデータが無い）で見る。
  // IDBからの復元直後は fetchStatus が idle のままの一瞬があり、isLoading は false でも
  // データはまだ無い。ここで isLoading を使うと、その一瞬だけ「未接続＋接続ボタン」が
  // 出てしまう（実際は接続済みでも）。
  const isPending = pendingInstallation || pendingConnection

  if (isPending) {
    return <div className="p-4 text-sm text-gray-500">読み込み中...</div>
  }

  if (!connection?.connected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          GitHubと連携して、PRとタスクを自動で紐付けできます。
        </p>
        {isOwner ? (
          <a
            href={`/api/github/authorize?orgId=${encodeURIComponent(orgId)}&redirect=${encodeURIComponent('/settings/org-integrations')}`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <GithubLogo className="text-lg" />
            GitHubと連携する
            <ArrowSquareOut className="text-sm" />
          </a>
        ) : (
          <p className="text-sm text-gray-500">組織のオーナーが接続できます。</p>
        )}
      </div>
    )
  }

  if (!connection.isMe) {
    // 接続済みだが本人ではない: github_installations は RLS で本人以外に0行しか返らないため、
    // アカウント名・リポジトリ一覧は出さず、接続した人の名前だけ出す
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="text-green-500" weight="fill" />
          <span className="text-gray-600">
            GitHub は接続済みです（接続した人: <strong>{connectedByName || '...'}</strong>）
          </span>
        </div>
        <p className="text-xs text-gray-500">
          リポジトリの追加・解除は、接続した人だけができます。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle className="text-green-500" weight="fill" />
        <span className="text-gray-600">
          <strong>{installation?.account_login}</strong> と連携中
        </span>
        <a
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline ml-2"
        >
          設定を変更
          <ArrowSquareOut className="inline ml-0.5 text-xs" />
        </a>
      </div>
      <p className="text-xs text-gray-500">
        各プロジェクト設定でリポジトリを紐付けできます。
      </p>
    </div>
  )
}

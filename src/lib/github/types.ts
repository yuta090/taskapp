// GitHub API Types

// access_token / token_expires_at は使われておらず(値0件)、列ごと削除する
// migration（20260911085205_github_column_grants.sql）に合わせ、型からも外す
export interface GitHubInstallation {
  id: string
  org_id: string
  installation_id: number
  account_login: string
  account_type: 'Organization' | 'User'
  created_by: string
  created_at: string
  updated_at: string
}

export interface GitHubRepository {
  id: string
  org_id: string
  installation_id: number
  repo_id: number
  owner_login: string
  repo_name: string
  full_name: string
  default_branch: string
  is_private: boolean
  created_at: string
  updated_at: string
}

export interface SpaceGitHubRepo {
  id: string
  org_id: string
  space_id: string
  github_repo_id: string
  sync_prs: boolean
  sync_commits: boolean
  created_by: string
  created_at: string
  github_repositories?: GitHubRepository
}

// pr_url / head_branch / base_branch / author_login / author_avatar_url は
// authenticated から読めない列（PR-B・接続者本人にも見せない設計）。
// リンク・作者名は画面側で github_repositories の埋め込み(full_name)から組み立てる
export interface GitHubPullRequest {
  id: string
  org_id: string
  github_repo_id: string
  pr_number: number
  pr_title: string
  pr_state: 'open' | 'closed' | 'merged'
  additions: number
  deletions: number
  commits_count: number
  merged_at?: string
  closed_at?: string
  pr_created_at: string
  updated_at: string
  github_repositories?: GitHubRepository
}

export interface TaskGitHubLink {
  id: string
  org_id: string
  task_id: string
  github_pr_id: string
  link_type: 'auto' | 'manual'
  created_by?: string
  created_at: string
  github_pull_requests?: GitHubPullRequest
}

// GitHub Issues 連携（GITHUB_ISSUES_LINK_SPEC.md §5・§9 PR1）

// url / author_login / assignee_logins は authenticated から読めない列（PR-B）。
// リンクは画面側で github_repositories の埋め込み(full_name)から組み立てる
export interface GitHubIssue {
  id: string
  org_id: string
  github_repo_id: string
  issue_number: number
  title: string
  state: 'open' | 'closed'
  state_reason: string | null
  issue_created_at: string | null
  closed_at: string | null
  github_updated_at: string | null
  last_synced_at: string
  created_at: string
  updated_at: string
  github_repositories?: GitHubRepository
}

export interface TaskGitHubIssueLink {
  id: string
  org_id: string
  task_id: string
  github_issue_id: string
  link_type: 'auto' | 'manual' | 'created'
  created_by?: string | null
  created_at: string
  github_issues?: GitHubIssue
}

/**
 * RPC `github_connection_status(p_org)` の戻り。「いま誰が接続しているか」を
 * 社内メンバーだけに返す（アカウント名・許可範囲は含まない）。設定画面などで
 * 「接続済み（接続者: ○○さん）」を出すために使う。
 * タスク画面のリポジトリ名・リンクの出し分けには使わない（github_repositories の
 * 埋め込みの有無＝RLSの結果そのもので決める）。
 */
export interface GitHubConnectionStatus {
  connected: boolean
  connectedBy: string | null
  connectedAt: string | null
  isMe: boolean
}

export interface TaskGitHubIssueRollup {
  task_id: string
  org_id: string
  open_count: number
  completed_count: number
  not_planned_count: number
  all_closed_at: string | null
  notified_at: string | null
  updated_at: string
}

/** github_apply_issue_state / github_recompute_issue_rollup が返す1タスクぶんの行 */
export interface GithubApplyIssueStateRow {
  task_id: string
  open_count_before: number
  open_count_after: number
  completed_count_after: number
  not_planned_count_after: number
  all_closed_at_after: string | null
  became_all_closed: boolean
}

// GitHub Webhook Event Types
export interface GitHubWebhookEvent {
  id: string
  org_id?: string
  installation_id?: number
  event_type: string
  action?: string
  delivery_id?: string
  payload: Record<string, unknown>
  processed: boolean
  error_message?: string
  received_at: string
}

// GitHub API Response Types
export interface GitHubAppInstallationPayload {
  installation: {
    id: number
    account: {
      login: string
      type: string
      avatar_url: string
    }
  }
  repositories?: Array<{
    id: number
    name: string
    full_name: string
    private: boolean
    default_branch: string
    owner: {
      login: string
    }
  }>
}

export interface GitHubPullRequestPayload {
  action: string
  number: number
  pull_request: {
    id: number
    number: number
    title: string
    html_url: string
    state: string
    merged: boolean
    body: string | null
    user: {
      login: string
      avatar_url: string
    }
    head: {
      ref: string
    }
    base: {
      ref: string
      repo: {
        id: number
        name: string
        full_name: string
        owner: {
          login: string
        }
      }
    }
    additions: number
    deletions: number
    commits: number
    merged_at: string | null
    closed_at: string | null
    created_at: string
    updated_at: string
  }
  repository: {
    id: number
    name: string
    full_name: string
    owner: {
      login: string
    }
  }
  installation: {
    id: number
  }
}

export interface GitHubIssuePayload {
  action:
    | 'opened'
    | 'edited'
    | 'closed'
    | 'reopened'
    | 'deleted'
    | 'transferred'
    | 'assigned'
    | 'unassigned'
    | string
  issue: {
    id: number
    number: number
    title: string
    body: string | null
    html_url: string
    state: string
    state_reason: string | null
    user: { login: string } | null
    assignees: Array<{ login: string }>
    // PR も Issues API に含まれる。このキーがあれば PR（GitHub Issues 側では扱わない）
    pull_request?: { url: string }
    created_at: string
    updated_at: string
    closed_at: string | null
  }
  // transferred のときだけ届く（移動先の情報）。実ペイロードの形は未確認（§7.1・実装時の注記）
  changes?: {
    new_repository?: {
      id: number
      name: string
      full_name: string
      owner: { login: string }
    }
    new_issue?: {
      number: number
    }
  }
  repository: {
    id: number
    name: string
    full_name: string
    owner: { login: string }
  }
  installation: { id: number }
}

export interface GitHubInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted'
  installation: {
    id: number
    account: {
      login: string
      type: string
    }
    // new_permissions_accepted のときに GitHub から届く、そのインストールの現在の許可範囲
    permissions?: Record<string, string>
  }
  repositories?: Array<{
    id: number
    name: string
    full_name: string
    private: boolean
  }>
}

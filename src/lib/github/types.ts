// GitHub API Types

export interface GitHubInstallation {
  id: string
  org_id: string
  installation_id: number
  account_login: string
  account_type: 'Organization' | 'User'
  access_token?: string
  token_expires_at?: string
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

export interface GitHubPullRequest {
  id: string
  org_id: string
  github_repo_id: string
  pr_number: number
  pr_title: string
  pr_url: string
  pr_state: 'open' | 'closed' | 'merged'
  author_login?: string
  author_avatar_url?: string
  head_branch?: string
  base_branch?: string
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

export interface GitHubInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted'
  installation: {
    id: number
    account: {
      login: string
      type: string
    }
  }
  repositories?: Array<{
    id: number
    name: string
    full_name: string
    private: boolean
  }>
}

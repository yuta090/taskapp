'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { isGitHubConfigured } from '@/lib/github/enabled'
import type {
  GitHubInstallation,
  GitHubRepository,
  SpaceGitHubRepo,
  GitHubPullRequest,
  TaskGitHubLink,
  GitHubIssue,
  TaskGitHubIssueLink,
  GitHubConnectionStatus,
} from '@/lib/github/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = createClient()

// =============================================================================
// PR-B: 列の絞り込み（GitHub の表は authenticated に select('*') を許さない）
//
// ここで名指しした列だけが、authenticated ロールに GRANT された列（本番 migration適用後）
// と一致する。select('*') のままだと migration 適用後に permission denied で全滅するため、
// 許可列を明示する形にしている。migration 適用前でも同じ列は当然読めるので、
// このコードは適用の前後どちらでも動く。
//
// pr_url / head_branch / base_branch / author_login / author_avatar_url（PR）、
// url / author_login / assignee_logins（Issue）は authenticated から一切読めない列
// （接続した本人でも読めない）。リンクは github_repositories の埋め込み(full_name)から
// 画面側で組み立てる。
// =============================================================================

const GITHUB_INSTALLATION_COLUMNS =
  'id, org_id, installation_id, account_login, account_type, created_by, created_at, updated_at'

const GITHUB_REPOSITORY_COLUMNS =
  'id, org_id, installation_id, repo_id, owner_login, repo_name, full_name, default_branch, is_private, created_at, updated_at'

// PR/Issue に埋め込むときは、画面がリンクを組み立てるのに必要な full_name だけで十分
const GITHUB_REPOSITORY_EMBED_COLUMNS = 'full_name'

const GITHUB_PULL_REQUEST_COLUMNS =
  'id, org_id, github_repo_id, pr_number, pr_title, pr_state, additions, deletions, commits_count, merged_at, closed_at, pr_created_at, updated_at'

const GITHUB_ISSUE_COLUMNS =
  'id, org_id, github_repo_id, issue_number, title, state, state_reason, issue_created_at, closed_at, github_updated_at, last_synced_at, created_at, updated_at'

// =============================================================================
// Organization Level Hooks
// =============================================================================

/**
 * 組織のGitHub連携状態を取得
 */
export function useGitHubInstallation(orgId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: ['github-installation', orgId],
    queryFn: async () => {
      if (!orgId) return null

      const { data, error } = await supabase
        .from('github_installations')
        .select(GITHUB_INSTALLATION_COLUMNS)
        .eq('org_id', orgId)
        .maybeSingle()

      if (error) throw error
      return data as GitHubInstallation | null
    },
    enabled: !!orgId && githubEnabled,
  })
}

/**
 * 組織の連携可能リポジトリ一覧を取得
 */
export function useGitHubRepositories(orgId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: ['github-repositories', orgId],
    queryFn: async () => {
      if (!orgId) return []

      const { data, error } = await supabase
        .from('github_repositories')
        .select(GITHUB_REPOSITORY_COLUMNS)
        .eq('org_id', orgId)
        .order('full_name')

      if (error) throw error
      return data as GitHubRepository[]
    },
    enabled: !!orgId && githubEnabled,
  })
}

// =============================================================================
// Space Level Hooks
// =============================================================================

/**
 * Spaceの連携リポジトリ一覧を取得
 */
export function useSpaceGitHubRepos(spaceId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: ['space-github-repos', spaceId],
    queryFn: async () => {
      if (!spaceId) return []

      const { data, error } = await supabase
        .from('space_github_repos')
        .select(`
          id, org_id, space_id, github_repo_id, sync_prs, sync_commits, created_by, created_at,
          github_repositories (${GITHUB_REPOSITORY_COLUMNS})
        `)
        .eq('space_id', spaceId)

      if (error) throw error
      return data as SpaceGitHubRepo[]
    },
    enabled: !!spaceId && githubEnabled,
  })
}

/**
 * Spaceにリポジトリを紐付け
 */
export function useLinkRepoToSpace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      spaceId,
      githubRepoId,
      syncPrs = true,
      syncCommits = false,
    }: {
      spaceId: string
      githubRepoId: string
      syncPrs?: boolean
      syncCommits?: boolean
    }) => {
      const res = await fetch('/api/github/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, githubRepoId, syncPrs, syncCommits }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to link repository')
      }

      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['space-github-repos', variables.spaceId],
      })
    },
  })
}

/**
 * Spaceからリポジトリの紐付けを解除
 */
export function useUnlinkRepoFromSpace() {
  const queryClient = useQueryClient()

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: async ({ linkId, spaceId }: { linkId: string; spaceId: string }) => {
      const res = await fetch(`/api/github/spaces?linkId=${linkId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to unlink repository')
      }

      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['space-github-repos', variables.spaceId],
      })
    },
  })
}

// =============================================================================
// Task Level Hooks
// =============================================================================

/**
 * タスクに紐付くPR一覧を取得
 */
export function useTaskGitHubLinks(taskId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: ['task-github-links', taskId],
    queryFn: async () => {
      if (!taskId) return []

      const { data, error } = await supabase
        .from('task_github_links')
        .select(`
          id, org_id, task_id, github_pr_id, link_type, created_by, created_at,
          github_pull_requests (
            ${GITHUB_PULL_REQUEST_COLUMNS},
            github_repositories (
              ${GITHUB_REPOSITORY_EMBED_COLUMNS}
            )
          )
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as TaskGitHubLink[]
    },
    enabled: !!taskId && githubEnabled,
  })
}

/**
 * SpaceのPR一覧を取得（リポジトリ横断）
 */
export function useSpacePullRequests(spaceId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: ['space-pull-requests', spaceId],
    queryFn: async () => {
      if (!spaceId) return []

      // Space に紐付くリポジトリのPRを取得
      const { data: spaceRepos } = await supabase
        .from('space_github_repos')
        .select('github_repo_id')
        .eq('space_id', spaceId)

      if (!spaceRepos || spaceRepos.length === 0) return []

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repoIds = spaceRepos.map((r: any) => r.github_repo_id)

      const { data, error } = await supabase
        .from('github_pull_requests')
        .select(`
          ${GITHUB_PULL_REQUEST_COLUMNS},
          github_repositories (
            ${GITHUB_REPOSITORY_EMBED_COLUMNS}
          )
        `)
        .in('github_repo_id', repoIds)
        .order('updated_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as GitHubPullRequest[]
    },
    enabled: !!spaceId && githubEnabled,
  })
}

/**
 * 手動でPRをタスクに紐付け
 */
export function useManualLinkPR() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      taskId,
      githubPrId,
      orgId,
    }: {
      taskId: string
      githubPrId: string
      orgId: string
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('task_github_links')
        .insert({
          org_id: orgId,
          task_id: taskId,
          github_pr_id: githubPrId,
          link_type: 'manual',
          created_by: user.id,
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('PR is already linked to this task')
        }
        throw error
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['task-github-links', variables.taskId],
      })
    },
  })
}

/**
 * PRとタスクの紐付けを解除
 */
export function useUnlinkPR() {
  const queryClient = useQueryClient()

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: async ({ linkId, taskId }: { linkId: string; taskId: string }) => {
      const { error } = await supabase
        .from('task_github_links')
        .delete()
        .eq('id', linkId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['task-github-links', variables.taskId],
      })
    },
  })
}

// =============================================================================
// GitHub Issues（GITHUB_ISSUES_LINK_SPEC.md §8・§9 PR1）
// =============================================================================

interface TaskGitHubIssuesData {
  links: TaskGitHubIssueLink[]
}

function taskGitHubIssuesQueryKey(taskId: string) {
  return ['task-github-issues', taskId] as const
}

/**
 * タスクに紐づく Issue の一覧を取得。
 *
 * 完了件数（「N件中M件完了」）は task_github_issue_rollups を別に取らず、この一覧の
 * 各 Issue の状態から画面側で数える（表示速度レビューでの是正・2026-09-11）。
 * 理由: 表を分けて2回取っても、一覧と集計が同時に更新されない一瞬（紐づけ・解除の直後）が
 * 生まれうる。一覧から数えれば同じデータなので原理的にずれない。通知の判定（PR3・サーバー側）は
 * 引き続き DB の集計行(task_github_issue_rollups)を正本にする。ここは画面の数え方だけの変更
 */
export function useTaskGitHubIssues(taskId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: taskId ? taskGitHubIssuesQueryKey(taskId) : ['task-github-issues', undefined],
    queryFn: async (): Promise<TaskGitHubIssuesData> => {
      if (!taskId) return { links: [] }

      const { data, error } = await supabase
        .from('task_github_issue_links')
        .select(`
          id, org_id, task_id, github_issue_id, link_type, created_by, created_at,
          github_issues (
            ${GITHUB_ISSUE_COLUMNS},
            github_repositories (
              ${GITHUB_REPOSITORY_EMBED_COLUMNS}
            )
          )
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })

      if (error) throw error

      return { links: (data ?? []) as TaskGitHubIssueLink[] }
    },
    enabled: !!taskId && githubEnabled,
  })
}

/**
 * 手動で紐づけるための候補Issue（そのプロジェクトに紐づくリポジトリのIssue）を
 * 番号・タイトルで検索する。
 *
 * repoIds は呼び出し側が既存の `useSpaceGitHubRepos(spaceId)` から作って渡す
 * （表示速度レビューでの是正・2026-09-11）。この hook 自身は space_github_repos を
 * 引かない＝検索の問い合わせは github_issues の1回だけになる。呼び出し側は search を
 * `useDebouncedValue` で落ち着かせてから渡すこと（打鍵ごとに問い合わせない）
 */
export function useIssueLinkCandidates(repoIds: string[], search: string) {
  const githubEnabled = isGitHubConfigured()
  // 配列の参照は毎レンダー変わりうるが、react-query の queryKey は値で比較するので
  // 中身が同じなら再取得しない。順序だけ揺れないよう並べておく
  const sortedRepoIds = [...repoIds].sort()

  return useQuery({
    queryKey: ['space-github-issue-candidates', sortedRepoIds, search],
    queryFn: async () => {
      if (sortedRepoIds.length === 0) return []

      let query = supabase
        .from('github_issues')
        .select(GITHUB_ISSUE_COLUMNS)
        .in('github_repo_id', sortedRepoIds)
        .order('issue_number', { ascending: false })
        .limit(50)

      const trimmed = search.trim()
      if (trimmed) {
        const numeric = trimmed.replace(/^#/, '')
        if (/^\d+$/.test(numeric)) {
          query = query.eq('issue_number', Number(numeric))
        } else {
          query = query.ilike('title', `%${trimmed}%`)
        }
      }

      const { data, error } = await query
      if (error) throw error
      return data as GitHubIssue[]
    },
    enabled: repoIds.length > 0 && githubEnabled,
    // 打ち直しのたびに空欄へ戻らないよう、前の結果を出したまま裏で取り直す
    // （FilesPageClient の useFileSearch と同じ型。一瞬「該当するIssueがありません」が出ない）
    placeholderData: (previous: GitHubIssue[] | undefined) => previous,
    // 打鍵の切れ目ごとに別キーが生まれるので、使い終わったら早めに捨てる
    gcTime: 5 * 60 * 1000,
  })
}

/**
 * 手動でIssueをタスクに紐付け。保存ボタンを置かない方針なので、押した瞬間に
 * 一覧へ反映し、失敗したときだけ元に戻す（楽観的更新）。完了件数の再計算は
 * DB のトリガーが行うので、確定したら取り直す
 */
export function useManualLinkIssue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      taskId,
      issue,
      orgId,
    }: {
      taskId: string
      issue: GitHubIssue
      orgId: string
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('task_github_issue_links')
        .insert({
          org_id: orgId,
          task_id: taskId,
          github_issue_id: issue.id,
          link_type: 'manual',
          created_by: user.id,
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('Issue is already linked to this task')
        }
        throw error
      }
    },
    onMutate: async ({ taskId, issue, orgId }) => {
      const queryKey = taskGitHubIssuesQueryKey(taskId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TaskGitHubIssuesData>(queryKey)

      queryClient.setQueryData<TaskGitHubIssuesData>(queryKey, (current) => {
        const base = current ?? { links: [] }
        const optimisticLink: TaskGitHubIssueLink = {
          id: `optimistic-${issue.id}`,
          org_id: orgId,
          task_id: taskId,
          github_issue_id: issue.id,
          link_type: 'manual',
          created_at: new Date().toISOString(),
          github_issues: issue,
        }
        return { ...base, links: [optimisticLink, ...base.links] }
      })

      return { previous }
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(taskGitHubIssuesQueryKey(variables.taskId), context.previous)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: taskGitHubIssuesQueryKey(variables.taskId) })
    },
  })
}

/**
 * Issueとタスクの紐付けを解除。押した瞬間に一覧から消し、失敗したら元に戻す（楽観的更新）
 */
export function useUnlinkIssue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ linkId }: { linkId: string; taskId: string }) => {
      const { error } = await supabase
        .from('task_github_issue_links')
        .delete()
        .eq('id', linkId)

      if (error) throw error
    },
    onMutate: async ({ taskId, linkId }) => {
      const queryKey = taskGitHubIssuesQueryKey(taskId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TaskGitHubIssuesData>(queryKey)

      queryClient.setQueryData<TaskGitHubIssuesData>(queryKey, (current) =>
        current ? { ...current, links: current.links.filter((l) => l.id !== linkId) } : current
      )

      return { previous }
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(taskGitHubIssuesQueryKey(variables.taskId), context.previous)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: taskGitHubIssuesQueryKey(variables.taskId) })
    },
  })
}

// =============================================================================
// GitHub 接続状態
//
// 「リポジトリ名・GitHubへのリンクを出してよいか」はタスク画面では使わない
// （github_repositories は接続した本人だけが読める RLS で既に守られており、埋め込みの
// full_name の有無がそのまま判定結果になる。isMe を足しても常に同じ結果にしかならず、
// 無駄な RPC を1回増やすだけのため、TaskPRList/TaskIssueList はこの hook を呼ばない）。
//
// 「いま誰が接続しているか」の社内向け情報（アカウント名・許可範囲までは返さない）で、
// 次の PR-C で設定画面・組織の連携画面の接続状態の表示に使う
// =============================================================================

interface GithubConnectionStatusRow {
  connected: boolean
  connected_by: string | null
  connected_at: string | null
  is_me: boolean
}

const EMPTY_CONNECTION_STATUS: GitHubConnectionStatus = {
  connected: false,
  connectedBy: null,
  connectedAt: null,
  isMe: false,
}

/**
 * RPC は `RETURNS TABLE`（配列で返る）と単一行（オブジェクトで返る）のどちらで実装されても
 * 動くよう、両方の形を吸収する。
 */
function normalizeConnectionStatusRow(raw: unknown): GithubConnectionStatusRow | null {
  const row = Array.isArray(raw) ? raw[0] : raw
  if (!row || typeof row !== 'object') return null
  return row as GithubConnectionStatusRow
}

export function useGitHubConnection(orgId: string | undefined) {
  const githubEnabled = isGitHubConfigured()

  return useQuery({
    queryKey: ['github-connection-status', orgId],
    queryFn: async (): Promise<GitHubConnectionStatus> => {
      const { data, error } = await supabase.rpc('github_connection_status', { p_org: orgId })

      if (error) throw error

      const row = normalizeConnectionStatusRow(data)
      if (!row) return EMPTY_CONNECTION_STATUS

      return {
        connected: row.connected ?? false,
        connectedBy: row.connected_by ?? null,
        connectedAt: row.connected_at ?? null,
        isMe: row.is_me ?? false,
      }
    },
    enabled: !!orgId && githubEnabled,
  })
}

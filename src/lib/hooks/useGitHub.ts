'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { isGitHubConfigured } from '@/lib/github/config'
import type {
  GitHubInstallation,
  GitHubRepository,
  SpaceGitHubRepo,
  GitHubPullRequest,
  TaskGitHubLink,
} from '@/lib/github/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = createClient()

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
        .select('*')
        .eq('org_id', orgId)
        .single()

      if (error && error.code !== 'PGRST116') { // not found is ok
        throw error
      }

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
        .select('*')
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
          *,
          github_repositories (*)
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
    mutationFn: async ({
      linkId,
      spaceId,
    }: {
      linkId: string
      spaceId: string
    }) => {
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
          *,
          github_pull_requests (
            *,
            github_repositories (
              full_name
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
          *,
          github_repositories (
            full_name
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
    mutationFn: async ({
      linkId,
      taskId,
    }: {
      linkId: string
      taskId: string
    }) => {
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

// GitHub Webhook Event Handlers
import { createClient } from '@supabase/supabase-js'
import { linkPRToTasks } from './task-linker'
import type {
  GitHubPullRequestPayload,
  GitHubInstallationPayload,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Pull Request イベントを処理
 */
export async function handlePullRequestEvent(
  data: GitHubPullRequestPayload
): Promise<{ success: boolean; linkedTasks?: string[] }> {
  const { action, pull_request: pr, repository, installation } = data

  // org_id を installation_id から逆引き
  const { data: inst } = await supabaseAdmin
    .from('github_installations')
    .select('org_id')
    .eq('installation_id', installation.id)
    .single()

  if (!inst) {
    console.log(`Unknown installation: ${installation.id}`)
    return { success: false }
  }

  // github_repo_id を取得
  const { data: repo } = await supabaseAdmin
    .from('github_repositories')
    .select('id')
    .eq('org_id', inst.org_id)
    .eq('repo_id', repository.id)
    .single()

  if (!repo) {
    console.log(`Unknown repository: ${repository.id}`)
    return { success: false }
  }

  // PR状態を判定
  const prState = pr.merged
    ? 'merged'
    : pr.state === 'closed'
    ? 'closed'
    : 'open'

  // PR情報を upsert
  const { data: prRecord, error: prError } = await supabaseAdmin
    .from('github_pull_requests')
    .upsert({
      org_id: inst.org_id,
      github_repo_id: repo.id,
      pr_number: pr.number,
      pr_title: pr.title,
      pr_url: pr.html_url,
      pr_state: prState,
      author_login: pr.user.login,
      author_avatar_url: pr.user.avatar_url,
      head_branch: pr.head.ref,
      base_branch: pr.base.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      commits_count: pr.commits,
      merged_at: pr.merged_at,
      closed_at: pr.closed_at,
      pr_created_at: pr.created_at,
    }, {
      onConflict: 'github_repo_id,pr_number',
    })
    .select('id')
    .single()

  if (prError) {
    console.error('Failed to upsert PR:', prError)
    return { success: false }
  }

  // 新規PR作成時のみタスクリンクを試行
  let linkedTasks: string[] = []
  if (action === 'opened' || action === 'edited') {
    const result = await linkPRToTasks(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseAdmin as any,
      inst.org_id,
      repo.id,
      prRecord.id,
      pr.title,
      pr.body
    )
    linkedTasks = result.linkedTasks
  }

  return { success: true, linkedTasks }
}

/**
 * Installation イベントを処理
 */
export async function handleInstallationEvent(
  data: GitHubInstallationPayload
): Promise<{ success: boolean }> {
  const { action, installation, repositories } = data

  switch (action) {
    case 'created': {
      // 新規インストール時はコールバックで処理するため、ここでは何もしない
      console.log(`Installation created: ${installation.id}`)
      break
    }

    case 'deleted': {
      // インストール削除時は関連データを削除
      const { error } = await supabaseAdmin
        .from('github_installations')
        .delete()
        .eq('installation_id', installation.id)

      if (error) {
        console.error('Failed to delete installation:', error)
        return { success: false }
      }
      break
    }

    case 'suspend':
    case 'unsuspend': {
      // 将来的に一時停止状態を管理する場合はここで処理
      console.log(`Installation ${action}: ${installation.id}`)
      break
    }

    default:
      console.log(`Unhandled installation action: ${action}`)
  }

  return { success: true }
}

/**
 * Installation Repositories イベントを処理（リポジトリ追加/削除）
 */
export async function handleInstallationRepositoriesEvent(
  data: {
    action: 'added' | 'removed'
    installation: { id: number }
    repositories_added?: Array<{
      id: number
      name: string
      full_name: string
      private: boolean
      owner: { login: string }
    }>
    repositories_removed?: Array<{ id: number }>
  }
): Promise<{ success: boolean }> {
  const { action, installation } = data

  // org_id を取得
  const { data: inst } = await supabaseAdmin
    .from('github_installations')
    .select('org_id')
    .eq('installation_id', installation.id)
    .single()

  if (!inst) {
    console.log(`Unknown installation: ${installation.id}`)
    return { success: false }
  }

  if (action === 'added' && data.repositories_added) {
    // リポジトリ追加
    const repos = data.repositories_added.map(repo => ({
      org_id: inst.org_id,
      installation_id: installation.id,
      repo_id: repo.id,
      owner_login: repo.owner.login,
      repo_name: repo.name,
      is_private: repo.private,
    }))

    const { error } = await supabaseAdmin
      .from('github_repositories')
      .upsert(repos, { onConflict: 'org_id,repo_id' })

    if (error) {
      console.error('Failed to add repositories:', error)
      return { success: false }
    }
  }

  if (action === 'removed' && data.repositories_removed) {
    // リポジトリ削除
    const repoIds = data.repositories_removed.map(r => r.id)

    const { error } = await supabaseAdmin
      .from('github_repositories')
      .delete()
      .eq('org_id', inst.org_id)
      .in('repo_id', repoIds)

    if (error) {
      console.error('Failed to remove repositories:', error)
      return { success: false }
    }
  }

  return { success: true }
}

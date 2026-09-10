// GitHub Webhook Event Handlers
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { linkPRToTasks, linkIssueToTasks } from './task-linker'
import { notifyTasksForMergedPR } from './merge-notify'
import type {
  GitHubPullRequestPayload,
  GitHubInstallationPayload,
  GitHubIssuePayload,
  GithubApplyIssueStateRow,
} from './types'

let _supabaseAdmin: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * Pull Request イベントを処理
 */
export async function handlePullRequestEvent(
  data: GitHubPullRequestPayload
): Promise<{ success: boolean; linkedTasks?: string[] }> {
  const { action, pull_request: pr, repository, installation } = data

  // org_id を installation_id から逆引き
  const { data: inst } = await getSupabaseAdmin()
    .from('github_installations')
    .select('org_id')
    .eq('installation_id', installation.id)
    .single()

  if (!inst) {
    console.log(`Unknown installation: ${installation.id}`)
    return { success: false }
  }

  // github_repo_id を取得
  const { data: repo } = await getSupabaseAdmin()
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
  const { data: prRecord, error: prError } = await getSupabaseAdmin()
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
      getSupabaseAdmin(),
      inst.org_id,
      repo.id,
      prRecord.id,
      pr.title,
      pr.body,
      pr.head.ref
    )
    linkedTasks = result.linkedTasks
  } else if (action === 'closed' && pr.merged) {
    // 取り込まれた(merge)時点でも、リポジトリ連携前に作られたPR等のつなぎ漏れを拾う。
    // その上で、紐づく社内の担当者・責任者に「知らせるだけ」の通知を送る
    // （GITHUB_ISSUES_LINK_SPEC §6 §12: タスク行は更新しない・ボールは動かさない）。
    const result = await linkPRToTasks(
      getSupabaseAdmin(),
      inst.org_id,
      repo.id,
      prRecord.id,
      pr.title,
      pr.body,
      pr.head.ref
    )
    linkedTasks = result.linkedTasks

    await notifyTasksForMergedPR(getSupabaseAdmin(), {
      orgId: inst.org_id,
      prId: prRecord.id,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
      repoFullName: repository.full_name,
    })
  }

  return { success: true, linkedTasks }
}

/**
 * became_all_closed のタスクのうち、原因が Issue のクローズであるものだけを選ぶ。
 * 通知（PR3）はここでは出さない。紐づけ・解除のトリガー経由の再計算では通知しないのと同じく、
 * closed 以外のイベント（opened/edited/reopened/assigned/unassigned・照合 cron 以外）でも
 * became_all_closed が true になることは無いはずだが、念のため action で絞る（GITHUB_ISSUES_LINK_SPEC §7.4）。
 */
export function selectTasksBecameAllClosedByIssueClose(
  action: string,
  results: GithubApplyIssueStateRow[]
): string[] {
  if (action !== 'closed') return []
  return results.filter((r) => r.became_all_closed).map((r) => r.task_id)
}

export interface HandleIssueEventResult {
  success: boolean
  results?: GithubApplyIssueStateRow[]
  /** became_all_closed かつ原因が closed イベントのタスク（PR3 がそのまま通知に使う。ここでは通知しない） */
  becameAllClosedByClose?: string[]
}

/**
 * Issue イベントを処理（GITHUB_ISSUES_LINK_SPEC.md §7.1・§7.2・§9 PR1）
 *
 * - opened/edited/closed/reopened/assigned/unassigned: Issue の書き換えと、紐づく全タスクの
 *   再計算を1回の RPC（github_apply_issue_state）で行う（通知の取りこぼし防止のため、
 *   github_issues への直接の upsert はしない）
 * - deleted: github_issues の行を削除（紐づけは cascade で消え、DB のトリガーが再計算する）
 * - transferred: 転送先が同じ org の github_repositories にあれば repo・番号・URL を書き換える。
 *   無ければ削除扱い（§7.1）
 * - TP-番号の自動紐づけは opened/edited のときだけ（linkIssueToTasks に委譲）
 * - tasks 行には一切書かない（§6-3）
 */
export async function handleIssueEvent(
  data: GitHubIssuePayload
): Promise<HandleIssueEventResult> {
  const { action, issue, repository, installation } = data

  // GitHub の Issues API は PR も Issue として返す。pull_request キーがあれば PR なので無視する
  if (issue.pull_request) {
    return { success: true }
  }

  const { data: inst } = await getSupabaseAdmin()
    .from('github_installations')
    .select('org_id')
    .eq('installation_id', installation.id)
    .single()

  if (!inst) {
    console.log(`Unknown installation: ${installation.id}`)
    return { success: false }
  }

  const { data: repo } = await getSupabaseAdmin()
    .from('github_repositories')
    .select('id')
    .eq('org_id', inst.org_id)
    .eq('repo_id', repository.id)
    .single()

  if (!repo) {
    console.log(`Unknown repository: ${repository.id}`)
    return { success: false }
  }

  if (action === 'deleted') {
    const { error } = await getSupabaseAdmin()
      .from('github_issues')
      .delete()
      .eq('github_repo_id', repo.id)
      .eq('issue_number', issue.number)

    if (error) {
      console.error('Failed to delete issue:', error)
      return { success: false }
    }
    return { success: true }
  }

  if (action === 'transferred') {
    const newRepoPayload = data.changes?.new_repository

    const newRepo = newRepoPayload
      ? await getSupabaseAdmin()
          .from('github_repositories')
          .select('id')
          .eq('org_id', inst.org_id)
          .eq('repo_id', newRepoPayload.id)
          .single()
          .then((res) => res.data as { id: string } | null)
      : null

    if (!newRepo) {
      // 転送先が同じ org の github_repositories に無い → 削除と同じ扱い（§7.1）
      const { error } = await getSupabaseAdmin()
        .from('github_issues')
        .delete()
        .eq('github_repo_id', repo.id)
        .eq('issue_number', issue.number)

      if (error) {
        console.error('Failed to delete transferred issue:', error)
        return { success: false }
      }
      return { success: true }
    }

    const newIssueNumber = data.changes?.new_issue?.number ?? issue.number
    const newUrl = `https://github.com/${newRepoPayload!.full_name}/issues/${newIssueNumber}`

    const { error } = await getSupabaseAdmin()
      .from('github_issues')
      .update({
        github_repo_id: newRepo.id,
        issue_number: newIssueNumber,
        url: newUrl,
      })
      .eq('github_repo_id', repo.id)
      .eq('issue_number', issue.number)

    if (error) {
      console.error('Failed to update transferred issue:', error)
      return { success: false }
    }
    return { success: true }
  }

  // opened/edited/closed/reopened/assigned/unassigned:
  // Issue の書き換えと、紐づく全タスクの再計算を1つの取引で行う
  const { data: rpcRows, error: rpcError } = await getSupabaseAdmin().rpc(
    'github_apply_issue_state',
    {
      p_org_id: inst.org_id,
      p_github_repo_id: repo.id,
      p_issue_number: issue.number,
      p_title: issue.title,
      p_url: issue.html_url,
      p_state: issue.state,
      p_state_reason: issue.state_reason ?? null,
      p_author_login: issue.user?.login ?? null,
      p_assignee_logins: (issue.assignees ?? []).map((a) => a.login),
      p_issue_created_at: issue.created_at,
      p_closed_at: issue.closed_at,
      p_github_updated_at: issue.updated_at,
    }
  )

  if (rpcError) {
    console.error('Failed to apply issue state:', rpcError)
    return { success: false }
  }

  const results = (rpcRows ?? []) as GithubApplyIssueStateRow[]

  // TP-番号の自動紐づけ（opened / edited のみ。§7.2）
  if (action === 'opened' || action === 'edited') {
    const { data: issueRow } = await getSupabaseAdmin()
      .from('github_issues')
      .select('id')
      .eq('github_repo_id', repo.id)
      .eq('issue_number', issue.number)
      .single()

    if (issueRow) {
      await linkIssueToTasks(
        getSupabaseAdmin(),
        inst.org_id,
        repo.id,
        issueRow.id,
        issue.title,
        issue.body
      )
    }
  }

  return {
    success: true,
    results,
    becameAllClosedByClose: selectTasksBecameAllClosedByIssueClose(action, results),
  }
}

/**
 * Installation イベントを処理
 */
export async function handleInstallationEvent(
  data: GitHubInstallationPayload
): Promise<{ success: boolean }> {
  const { action, installation } = data

  switch (action) {
    case 'created': {
      // 新規インストール時はコールバックで処理するため、ここでは何もしない
      console.log(`Installation created: ${installation.id}`)
      break
    }

    case 'deleted': {
      // インストール削除時は関連データを削除
      const { error } = await getSupabaseAdmin()
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

    case 'new_permissions_accepted': {
      // 導入先が許可範囲の変更を承認したときの通知。現在の許可範囲を記録する
      // （GITHUB_ISSUES_LINK_SPEC.md §5・§7.6）。
      // 列（permissions / permissions_updated_at）は本番マイグレーション適用前に
      // このコードが先に出ても壊れないよう、失敗してもログのみで webhook 処理は止めない。
      const { error } = await getSupabaseAdmin()
        .from('github_installations')
        .update({
          permissions: installation.permissions ?? null,
          permissions_updated_at: new Date().toISOString(),
        })
        .eq('installation_id', installation.id)

      if (error) {
        console.error('Failed to save installation permissions:', error)
      }
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
  const { data: inst } = await getSupabaseAdmin()
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

    const { error } = await getSupabaseAdmin()
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

    const { error } = await getSupabaseAdmin()
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

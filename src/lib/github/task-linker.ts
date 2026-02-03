// タスクID自動検出とPR紐付け
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

// タスクID検出パターン: #TP-001, TP-001, [TP-001]
// 単語境界を使用して誤検出を防止（例: HTTP-001 を TP-001 と誤認しない）
const TASK_ID_PATTERN = /(?:^|[\s\[\(#])(?:#?)(TP-\d+)(?:[\]\)\s,.:;]|$)/gi

/**
 * テキストからタスクIDを抽出
 */
export function extractTaskIds(text: string): string[] {
  const matches = [...text.matchAll(TASK_ID_PATTERN)]
  const taskIds = matches.map(m => m[1].toUpperCase())
  return [...new Set(taskIds)] // 重複除去
}

/**
 * PRをタスクに紐付け
 */
export async function linkPRToTasks(
  supabase: SupabaseClient,
  orgId: string,
  githubRepoId: string,
  prId: string,
  prTitle: string,
  prBody: string | null
): Promise<{ linkedTasks: string[] }> {
  const linkedTasks: string[] = []

  // タイトルと本文からタスクID抽出
  const text = `${prTitle} ${prBody || ''}`
  const taskShortIds = extractTaskIds(text)

  if (taskShortIds.length === 0) {
    return { linkedTasks }
  }

  // 該当タスクを検索
  for (const shortId of taskShortIds) {
    // short_id から数字部分を抽出（TP-042 → 42）
    const numericId = parseInt(shortId.replace('TP-', ''), 10)

    const { data: task } = await supabase
      .from('tasks')
      .select('id, space_id')
      .eq('org_id', orgId)
      .eq('short_id', numericId)
      .single()

    if (!task) continue

    // Space がこのリポジトリと連携しているか確認
    const { data: spaceRepo } = await supabase
      .from('space_github_repos')
      .select('id')
      .eq('space_id', task.space_id)
      .eq('github_repo_id', githubRepoId)
      .single()

    if (!spaceRepo) continue

    // リンク作成（既存の場合は無視）
    const { error } = await supabase
      .from('task_github_links')
      .upsert({
        org_id: orgId,
        task_id: task.id,
        github_pr_id: prId,
        link_type: 'auto',
      }, {
        onConflict: 'task_id,github_pr_id',
        ignoreDuplicates: true,
      })

    if (!error) {
      linkedTasks.push(shortId)
    }
  }

  return { linkedTasks }
}

/**
 * 手動でPRをタスクに紐付け
 */
export async function manualLinkPRToTask(
  supabase: SupabaseClient,
  orgId: string,
  taskId: string,
  githubPrId: string,
  createdBy: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('task_github_links')
    .insert({
      org_id: orgId,
      task_id: taskId,
      github_pr_id: githubPrId,
      link_type: 'manual',
      created_by: createdBy,
    })

  if (error) {
    if (error.code === '23505') { // unique violation
      return { success: false, error: 'Already linked' }
    }
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * PRとタスクの紐付けを解除
 */
export async function unlinkPRFromTask(
  supabase: SupabaseClient,
  linkId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  // 作成者のみ削除可能（RLSで制御されるが、念のため）
  const { error } = await supabase
    .from('task_github_links')
    .delete()
    .eq('id', linkId)
    .eq('created_by', userId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

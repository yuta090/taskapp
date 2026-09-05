import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config, getAuthContext } from '../config.js'
import { authorizeAndLog } from '../auth/index.js'
import {
  parseTaskImportCsv,
  planTaskImport,
  type ImportIssue,
  type PlannedTask,
  type UserDirectory,
} from '../lib/taskImportPlan.js'

/**
 * task_import — CSV からタスクを一括作成する（`agentpm task import` の実体）。
 *
 * 設計:
 *   - 既定は dryRun=true。作成計画（何件作る・何件スキップ・どこがエラーか）だけ返し、DBは触らない。
 *     `--no-dry-run` で初めて書く。task_delete と同じ「まず見せる」流儀。
 *   - 全か無か: 1行でもエラーがあれば実行モードでも1件も作らない。半端に入った状態の後始末が
 *     一番高くつくため。
 *   - 再実行に強い: 同じタイトルのタスクがスペースに既にあれば作らずスキップする。
 *   - 親→子の順に深さごとに insert する。tasks の親子検証トリガー(BEFORE ROW)は同一 INSERT 文の
 *     先行行を見られないため、深さ別に文を分ける。id はここで採番して parent_task_id を先に確定させる。
 *   - 認可は 'bulk'（client_invite_bulk_create と同じ区分。editor 権限のキーでは通らない）。
 *
 * CSV の解釈ルールはすべて ../lib/taskImportPlan.ts にある（ここは DB との橋渡しのみ）。
 */

export const taskImportSchema = z.object({
  spaceId: z.string().uuid().describe('取り込み先スペースUUID（必須）'),
  csv: z.string().min(1).max(2_000_000).describe('CSV本文。1行目はヘッダー（title は必須列。英語キー/日本語ラベルどちらでも可）'),
  dryRun: z.boolean().default(true).describe('trueなら作成せず計画だけ返す（既定）。falseで実際に作成する'),
})

export interface TaskImportPreviewRow {
  line: number | null
  title: string
  status: string
  ball: string
  clientScope: string
  dueDate: string | null
  parent: string | null
  autoParent: boolean
}

export interface TaskImportResult {
  success: boolean
  dryRun: boolean
  summary: { rows: number; toCreate: number; autoParents: number; skipped: number; errors: number }
  errors: ImportIssue[]
  skipped: { line: number; title: string; reason: string }[]
  ignoredColumns: string[]
  preview: TaskImportPreviewRow[]
  created: { id: string; title: string; parentId: string | null }[]
  message: string
}

const IN_CHUNK = 200
const LIST_USERS_PER_PAGE = 1000
const LIST_USERS_MAX_PAGES = 10

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function loadExistingTasks(spaceId: string, titles: string[]): Promise<Map<string, string>> {
  const supabase = getSupabaseClient()
  const map = new Map<string, string>()
  for (const part of chunk([...new Set(titles)], IN_CHUNK)) {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('space_id', spaceId)
      .in('title', part)
    if (error) throw new Error(`既存タスクの確認に失敗しました: ${error.message}`)
    for (const row of (data ?? []) as { id: string; title: string }[]) {
      if (!map.has(row.title)) map.set(row.title, row.id)
    }
  }
  return map
}

/**
 * 組織メンバーの「表示名 → id」「メール → id」を作る。
 * メールは auth.users にしかないため、CSV がメールで人を参照している場合だけ
 * auth.admin.listUsers をページングして引く（組織メンバー以外は捨てる）。
 */
async function loadUserDirectory(orgId: string, needEmails: boolean): Promise<UserDirectory> {
  const supabase = getSupabaseClient()
  const { data: members, error: mErr } = await supabase
    .from('org_memberships')
    .select('user_id, role')
    .eq('org_id', orgId)
  if (mErr) throw new Error(`メンバー一覧の取得に失敗しました: ${mErr.message}`)
  const memberIds = new Set((members ?? []).map((m: { user_id: string }) => m.user_id))

  const byName = new Map<string, string[]>()
  for (const part of chunk([...memberIds], IN_CHUNK)) {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', part)
    if (pErr) throw new Error(`プロフィールの取得に失敗しました: ${pErr.message}`)
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
      const name = (p.display_name ?? '').trim()
      if (!name) continue
      const list = byName.get(name) ?? []
      list.push(p.id)
      byName.set(name, list)
    }
  }

  const byEmail = new Map<string, string>()
  if (needEmails) {
    for (let page = 1; page <= LIST_USERS_MAX_PAGES; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: LIST_USERS_PER_PAGE })
      if (error) throw new Error(`ユーザー情報の取得に失敗しました: ${error.message}`)
      const users = data?.users ?? []
      for (const u of users) {
        if (u.email && memberIds.has(u.id)) byEmail.set(u.email.toLowerCase(), u.id)
      }
      if (users.length < LIST_USERS_PER_PAGE) break
    }
  }

  return { byEmail, byName }
}

async function loadMilestones(spaceId: string): Promise<Map<string, string>> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('milestones')
    .select('id, name')
    .eq('space_id', spaceId)
  if (error) throw new Error(`マイルストーンの取得に失敗しました: ${error.message}`)
  const map = new Map<string, string>()
  for (const m of (data ?? []) as { id: string; name: string }[]) {
    if (!map.has(m.name)) map.set(m.name, m.id)
  }
  return map
}

function toPreview(tasks: PlannedTask[], existingTasks: Map<string, string>): TaskImportPreviewRow[] {
  const titleById = new Map<string, string>()
  for (const t of tasks) titleById.set(t.id, t.title)
  for (const [title, id] of existingTasks) titleById.set(id, title)
  return tasks.map((t) => ({
    line: t.line,
    title: t.title,
    status: t.status,
    ball: t.ball,
    clientScope: t.clientScope,
    dueDate: t.dueDate,
    parent: t.parentId ? titleById.get(t.parentId) ?? t.parentId : null,
    autoParent: t.autoParent,
  }))
}

export async function taskImport(params: z.infer<typeof taskImportSchema>): Promise<TaskImportResult> {
  const ctx = getAuthContext()
  const auth = await authorizeAndLog({
    ctx,
    spaceId: params.spaceId,
    action: 'bulk',
    toolName: 'task_import',
    resourceType: 'task',
  })
  if (!auth.allowed) throw new Error(`権限エラー: ${auth.reason}`)

  const supabase = getSupabaseClient()
  const { data: space, error: spaceError } = await supabase
    .from('spaces')
    .select('org_id')
    .eq('id', params.spaceId)
    .single()
  if (spaceError || !space) throw new Error('スペースが見つかりません')
  const orgId = (space as { org_id: string }).org_id

  const parsed = parseTaskImportCsv(params.csv)
  const base = {
    dryRun: params.dryRun,
    ignoredColumns: parsed.ignoredColumns,
    preview: [] as TaskImportPreviewRow[],
    created: [] as TaskImportResult['created'],
  }
  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    return {
      ...base,
      success: false,
      summary: { rows: 0, toCreate: 0, autoParents: 0, skipped: 0, errors: parsed.errors.length },
      errors: parsed.errors,
      skipped: [],
      message: 'CSVを読み取れませんでした',
    }
  }

  const peopleRefs = parsed.rows.flatMap((r) => [r.assignee ?? '', ...r.clientOwners, ...r.internalOwners])
  const needEmails = peopleRefs.some((ref) => ref.includes('@'))
  const titles = parsed.rows.flatMap((r) => (r.parent ? [r.title, r.parent] : [r.title]))

  const [existingTasks, users, milestones] = await Promise.all([
    loadExistingTasks(params.spaceId, titles),
    loadUserDirectory(orgId, needEmails),
    loadMilestones(params.spaceId),
  ])

  const plan = planTaskImport({
    rows: parsed.rows,
    existingTasks,
    users,
    milestones,
    newId: () => randomUUID(),
  })
  const errors = [...parsed.errors, ...plan.errors]
  const summary = {
    rows: parsed.rows.length + parsed.errors.length,
    toCreate: plan.tasks.length,
    autoParents: plan.autoParents.length,
    skipped: plan.skipped.length,
    errors: errors.length,
  }

  if (errors.length > 0) {
    return {
      ...base,
      success: false,
      summary,
      errors,
      skipped: plan.skipped,
      message: `${errors.length}件のエラーがあるため取り込みを中止しました（1件も作成していません）`,
    }
  }

  const preview = toPreview(plan.tasks, existingTasks)

  if (params.dryRun) {
    return {
      ...base,
      success: true,
      summary,
      errors: [],
      skipped: plan.skipped,
      preview,
      message: `確認のみ（作成していません）。${summary.toCreate}件を作成予定（うち自動作成の親 ${summary.autoParents}件）、${summary.skipped}件は既にあるためスキップ。実行するには --no-dry-run を付けてください`,
    }
  }

  // 深さ別に親→子の順で insert
  const byDepth = new Map<number, PlannedTask[]>()
  for (const t of plan.tasks) byDepth.set(t.depth, [...(byDepth.get(t.depth) ?? []), t])
  const created: TaskImportResult['created'] = []
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const level = byDepth.get(depth)!
    const rows = level.map((t) => ({
      id: t.id,
      org_id: orgId,
      space_id: params.spaceId,
      title: t.title,
      description: t.description,
      status: t.status,
      ball: t.ball,
      origin: t.origin,
      type: 'task',
      client_scope: t.clientScope,
      start_date: t.startDate,
      due_date: t.dueDate,
      assignee_id: t.assigneeId,
      parent_task_id: t.parentId,
      priority: t.priority,
      milestone_id: t.milestoneId,
      created_by: config.actorId,
    }))
    const { error } = await supabase.from('tasks').insert(rows).select('id')
    if (error) {
      throw new Error(
        `タスクの作成に失敗しました（${created.length}件は作成済み。残りは未作成）: ${error.message}`,
      )
    }
    for (const t of level) created.push({ id: t.id, title: t.title, parentId: t.parentId })
  }

  const ownerRows = plan.tasks.flatMap((t) => [
    ...t.clientOwnerIds.map((userId) => ({ org_id: orgId, space_id: params.spaceId, task_id: t.id, side: 'client', user_id: userId })),
    ...t.internalOwnerIds.map((userId) => ({ org_id: orgId, space_id: params.spaceId, task_id: t.id, side: 'internal', user_id: userId })),
  ])
  if (ownerRows.length > 0) {
    const { error } = await supabase.from('task_owners').insert(ownerRows)
    if (error) throw new Error(`担当者の登録に失敗しました（タスク ${created.length}件は作成済み）: ${error.message}`)
  }

  return {
    ...base,
    success: true,
    summary,
    errors: [],
    skipped: plan.skipped,
    preview,
    created,
    message: `${created.length}件のタスクを作成しました（うち自動作成の親 ${summary.autoParents}件、スキップ ${summary.skipped}件）`,
  }
}

export const taskImportTools = [
  {
    name: 'task_import',
    description: 'CSVからタスクを一括作成。dryRun=true(既定)で計画確認、false で作成。同名タスクはスキップ・親は parent 列のタイトルで指定',
    inputSchema: taskImportSchema,
    handler: taskImport,
  },
]

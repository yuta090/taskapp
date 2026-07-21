import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import { enqueueConnectorJob } from '@/lib/connectors/enqueue'
import { CONNECTOR_SYSTEM_USER_ID } from '@/lib/connectors/systemUser'
import { GOOGLE_TASKS_LIST_TITLE } from './config'
import { listTaskLists, listTasks, googleDueToDateString, type GoogleTask } from './client'

/**
 * gtasks import ワーカー: import_enabled な google_tasks 接続について、外部(Google Tasks)を
 * 正本として TaskApp へタスクを取り込む(逆流ポーリング(poll.ts)の隣・順方向とは別方向)。
 *
 * 正本ルール: 既存タスク管理アプリ(gtasks)を使う企業はそのツールが正本 → 取り込んだ TaskApp
 * タスクには connector_task_links.origin='external' を張る(tasks.origin(ball概念)とは別軸)。
 *
 * エコー回避(二重ガード。手書きコピー(B2)は原理的に検知不能なため対象外・許容):
 *   (a) リスト分離: import 対象からミラー出力先リスト(title=GOOGLE_TASKS_LIST_TITLE)を必ず除外。
 *       read_list_ids で明示指定されていても上書きできない(手違いでの反響を構造的に防ぐ)。
 *   (b) ref/link ガード: user_task_mirror_refs(TaskApp が押し出した写し)に既にある
 *       google_task_id は取り込まない。
 *
 * 冪等: connector_task_links の unique(connection_id, external_id) に守られる。カーソル
 * オーバーラップ(60秒)で同一 external_id を2回見ても、2回目は既存 link → update に倒れ
 * タスクは1件のまま(insert は起きない)。
 */

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export interface ImportSummary {
  connections: number
  created: number
  updated: number
  completed: number
  skipped: number
}

/**
 * import_config の形(本ワーカーで最小定義。詳細は docs/spec/MULTICA_CONNECTOR_CONTRACT.md §10 参照):
 *   - target_space_id: 取り込み先の space(必須。無ければ接続を skip)
 *   - read_list_ids?: 読み取り対象の gtasks リストID。省略時は「ミラー出力リスト以外の全リスト」
 *   - default_assignee_id?: 新規作成タスクの担当者
 */
interface ImportConfig {
  read_list_ids?: string[]
  target_space_id?: string
  default_assignee_id?: string
}

interface ConnRow {
  id: string
  org_id: string
  import_config: Record<string, unknown> | null
  poll_cursor: string | null
}

function parseImportConfig(raw: Record<string, unknown> | null): ImportConfig {
  const c = raw ?? {}
  return {
    read_list_ids: Array.isArray(c.read_list_ids)
      ? (c.read_list_ids.filter((x): x is string => typeof x === 'string') as string[])
      : undefined,
    target_space_id: typeof c.target_space_id === 'string' ? c.target_space_id : undefined,
    default_assignee_id: typeof c.default_assignee_id === 'string' ? c.default_assignee_id : undefined,
  }
}

/** 接続の対応リンクを external_id -> task_id の Map に読み込む(同一バッチ内の重複再取得を畳むため先読み)。 */
async function loadLinkMap(connectionId: string): Promise<Map<string, string>> {
  const { data, error } = await admin()
    .from('connector_task_links')
    .select('task_id, external_id')
    .eq('connection_id', connectionId)
  if (error) throw new Error(`loadLinkMap failed: ${error.message}`)
  const map = new Map<string, string>()
  for (const r of (data as Array<{ task_id: string; external_id: string }> | null) ?? []) {
    map.set(r.external_id, r.task_id)
  }
  return map
}

/** エコー回避(b): この接続がミラー出力済みの google_task_id 集合。 */
async function loadMirrorRefIds(connectionId: string): Promise<Set<string>> {
  const { data, error } = await admin()
    .from('user_task_mirror_refs')
    .select('google_task_id')
    .eq('connection_id', connectionId)
  if (error) throw new Error(`loadMirrorRefIds failed: ${error.message}`)
  return new Set(((data as Array<{ google_task_id: string }> | null) ?? []).map((r) => r.google_task_id))
}

/** 外部タスクを新規 TaskApp タスクとして作成し、connector_task_links(origin=external)を張る。 */
async function createExternalTask(
  conn: ConnRow,
  config: ImportConfig,
  gt: GoogleTask,
  listId: string,
  assigneeId: string | null,
): Promise<string> {
  const { data: task, error: insErr } = await admin()
    .from('tasks')
    .insert({
      org_id: conn.org_id,
      space_id: config.target_space_id,
      title: gt.title?.trim() || '(無題)',
      // description は NOT NULL default ''。明示 null を入れると default が効かず NOT NULL 違反になる。
      description: gt.notes ?? '',
      due_date: googleDueToDateString(gt.due),
      status: gt.status === 'completed' ? 'done' : 'todo',
      // ball/origin(ball概念): gtasks は自社の既存タスク管理ツール=社内発の扱い。クライアント起票ではない。
      ball: 'internal',
      origin: 'internal',
      // client_scope default は 'deliverable'。外部由来タスクが顧客ポータルに露出しないよう internal を明示。
      client_scope: 'internal',
      type: 'task',
      assignee_id: assigneeId,
      // AI秘書 Stage5 期限リマインド(PR-0・§5.3): dueImportコネクタ(gtasks)の取り込みタスクは
      // この接続を期限の正本にする(=TaskAppからは編集不可・trg_guard_external_dueで強制)。
      // INSERTのためBEFORE UPDATEトリガーは発火しない(挿入時点で権威を確定するだけ)。
      due_authority_connection_id: conn.id,
      // created_by は NOT NULL。外部起票に対応する対話ユーザーは居ないため専用システムユーザー名義にする
      // (実ユーザー=org owner の名義にしない。UI には profiles の「外部連携（システム）」が表示される)。
      created_by: CONNECTOR_SYSTEM_USER_ID,
    })
    .select('id')
    .single()
  if (insErr || !task) throw new Error(`create task failed: ${insErr?.message}`)
  const taskId = (task as { id: string }).id

  const { error: linkErr } = await admin().from('connector_task_links').insert({
    connection_id: conn.id,
    task_id: taskId,
    external_id: gt.id,
    external_list_id: listId,
    origin: 'external',
  })
  if (linkErr) {
    // 競合(unique violation): 他経路(並行実行)で既に link 済み。重複タスクを残さないよう
    // 今作った task を補償削除し、既存の対応(task_id)へ倒す。
    if ((linkErr as { code?: string }).code === '23505') {
      const { data: existing } = await admin()
        .from('connector_task_links')
        .select('task_id')
        .eq('connection_id', conn.id)
        .eq('external_id', gt.id)
        .maybeSingle()
      await admin().from('tasks').delete().eq('id', taskId)
      if (existing) return (existing as { task_id: string }).task_id
    }
    throw new Error(`create link failed: ${linkErr.message}`)
  }
  return taskId
}

/**
 * 双方向同期コネクタ層(multica)への enqueue。この接続の org に active な multica 接続があれば
 * その id を返す(無ければ null)。best-effort: DBエラーはログのみで null 扱い(gtasks import 自体は
 * 継続する。multica 連携はあくまで付随機能でgtasks取り込みの成否をブロックしない)。
 */
async function findActiveMulticaConnectionId(orgId: string): Promise<string | null> {
  try {
    const { data, error } = await admin()
      .from('integration_connections')
      .select('id')
      .eq('org_id', orgId)
      .eq('provider', 'multica')
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw new Error(`findActiveMulticaConnectionId failed: ${error.message}`)
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[gtasks-import] findActiveMulticaConnectionId failed(multica連携をskipして継続):', err)
    return null
  }
}

/** multica への issue.upsert enqueue payload(契約 §3.1)。gtasks取り込みは進行中ステータスを持たないため既定 todo。 */
function buildMulticaUpsertPayload(gt: GoogleTask): Record<string, unknown> {
  return {
    title: gt.title?.trim() || '(無題)',
    body: gt.notes ?? null,
    status: 'todo',
    due_date: googleDueToDateString(gt.due),
    assignee_hint: null,
    origin: 'external',
  }
}

/** 既存 link のある TaskApp タスクをタイトル/期日/本文で更新する。 */
async function updateExternalTask(taskId: string, gt: GoogleTask): Promise<void> {
  const { error } = await admin()
    .from('tasks')
    .update({
      title: gt.title?.trim() || '(無題)',
      // description は NOT NULL default ''。明示 null で NOT NULL 違反になると update が throw →
      // importConnection の catch で cursor 未前進 → 当該接続が同一バッチを永久リトライして取り込み
      // 恒久停止する。notes 無しタスク(大多数)や完了同期(updateを先に通る)を壊さないため '' に統一。
      description: gt.notes ?? '',
      due_date: googleDueToDateString(gt.due),
    })
    .eq('id', taskId)
  if (error) throw new Error(`update task failed: ${error.message}`)
}

/**
 * クロステナント防御(#1): import 先の space/assignee が接続の org に属するか検証する。
 * ワーカーは service_role で RLS をバイパスし、project space の org 不整合は tasks トリガーも
 * 検査しない。誤設定/悪意の import_config で別 org の space にタスク行を作らせないための境界。
 *   - space が接続の org に属さない/存在しない → 接続を skip(取り込み全体を止める)。
 *   - assignee が org メンバーでない → 担当を外す(null)。取り込み自体は続ける。
 * ※ 書き込み境界(何を設定できるか)は Fable 決定により DB トリガー
 *   integration_connections_validate_import_config(20260720181730_...) が担い、org 外の
 *   space/assignee を**書込時に**拒否する。本関数はそれを削除せず**第二防衛**として残す:
 *   トリガーは書込時点の検証のみで、設定後に space の org 帰属や assignee のメンバーシップが
 *   変わる drift(TOCTOU)は防げないため、実行時検証が真のセキュリティ境界であることは不変。
 */
async function validateImportTarget(
  conn: ConnRow,
  config: ImportConfig,
): Promise<{ ok: boolean; assigneeId: string | null }> {
  const { data: space, error } = await admin()
    .from('spaces')
    .select('org_id')
    .eq('id', config.target_space_id!)
    .maybeSingle()
  if (error) throw new Error(`validateImportTarget space lookup failed: ${error.message}`)
  if (!space || (space as { org_id: string }).org_id !== conn.org_id) {
    console.error('[gtasks-import] target_space_id が接続の org に属さない。接続を skip:', conn.id)
    return { ok: false, assigneeId: null }
  }

  let assigneeId: string | null = config.default_assignee_id ?? null
  if (assigneeId) {
    const { data: mem, error: memErr } = await admin()
      .from('org_memberships')
      .select('user_id')
      .eq('org_id', conn.org_id)
      .eq('user_id', assigneeId)
      .maybeSingle()
    if (memErr) throw new Error(`validateImportTarget membership lookup failed: ${memErr.message}`)
    if (!mem) {
      console.error('[gtasks-import] default_assignee_id が org メンバーでない。担当を外して継続:', conn.id)
      assigneeId = null
    }
  }
  return { ok: true, assigneeId }
}

async function importConnection(conn: ConnRow, summary: ImportSummary): Promise<void> {
  const config = parseImportConfig(conn.import_config)
  if (!config.target_space_id) {
    // 取り込み先が未設定。import_enabled でも運用側の設定待ちとして skip する。
    summary.skipped++
    return
  }

  // クロステナント防御: space/assignee の org 所属を検証(#1)。
  let effectiveAssignee: string | null
  try {
    const v = await validateImportTarget(conn, config)
    if (!v.ok) {
      summary.skipped++
      return
    }
    effectiveAssignee = v.assigneeId
  } catch (err) {
    console.error('[gtasks-import] validateImportTarget failed, skip:', err)
    summary.skipped++
    return
  }

  const tok = await getValidTokenDetailed(conn.id, refreshAccessToken)
  if (tok.status !== 'ok') {
    summary.skipped++
    return
  }

  let lists: Array<{ id: string; title: string }>
  try {
    lists = await listTaskLists(tok.token)
  } catch (err) {
    console.error('[gtasks-import] listTaskLists failed, skip:', err)
    summary.skipped++
    return
  }
  const mirrorListId = lists.find((l) => l.title === GOOGLE_TASKS_LIST_TITLE)?.id
  const realIds = new Set(lists.map((l) => l.id))
  // read_list_ids は実在リストと交差させる。存在しないID(gtasks側の削除/typo)を1つでも含むと、
  // listTasks(無効ID) の 404 で catch → cursor 未前進を毎サイクル繰り返し、その接続が正常リストも
  // 含め永久に取り込めなくなる(wedge)。実在するIDだけに絞ってこれを防ぐ。
  const configured =
    config.read_list_ids && config.read_list_ids.length > 0
      ? config.read_list_ids.filter((id) => realIds.has(id))
      : lists.map((l) => l.id)
  // エコー回避(a): ミラー出力先リストは import 対象から必ず除外する(明示指定でも上書き不可)。
  const candidateIds = configured.filter((id) => id !== mirrorListId)
  if (candidateIds.length === 0) {
    summary.skipped++
    return
  }

  const cursor = conn.poll_cursor ?? undefined
  // 次回カーソルはポーリング開始時刻の少し手前(境界の取りこぼし防止)。poll.ts と同じカーソル用途の
  // 例外として toISOString を使う(ローカル日付表示ではなくタイムスタンプカーソルのため)。
  const nextCursor = new Date(Date.now() - 60_000).toISOString()

  // 双方向同期コネクタ層: この org に active な multica 接続があれば、取り込んだ/更新した
  // external タスクを connector_jobs 経由で multica へも流す(承認済み既定)。1接続分の取り込みで
  // 使い回すため importConnection 内で一度だけ解決する(タスク行ごとに問い合わせない)。
  const multicaConnectionId = await findActiveMulticaConnectionId(conn.org_id)

  let linkMap: Map<string, string> | null = null
  let refIds: Set<string> | null = null

  try {
    for (const listId of candidateIds) {
      let pageToken: string | undefined
      do {
        const { items, nextPageToken } = await listTasks(tok.token, listId, { updatedMin: cursor, pageToken })
        for (const gt of items) {
          if (gt.deleted) continue
          if (!refIds) refIds = await loadMirrorRefIds(conn.id)
          if (refIds.has(gt.id)) continue // エコー回避(b)

          if (!linkMap) linkMap = await loadLinkMap(conn.id)
          const existingTaskId = linkMap.get(gt.id)
          if (existingTaskId) {
            await updateExternalTask(existingTaskId, gt)
            summary.updated++
            if (gt.status === 'completed') {
              const { data, error } = await admin().rpc('rpc_connector_complete_task', {
                p_connection_id: conn.id,
                p_task_id: existingTaskId,
              })
              if (error) throw new Error(`rpc_connector_complete_task failed: ${error.message}`)
              if (data === true) {
                summary.completed++
                // gtasks が先に完了 → multica の AI依頼を閉じる(0→1遷移のときだけ。二重送信しない)。
                if (multicaConnectionId) {
                  await enqueueConnectorJob(multicaConnectionId, existingTaskId, 'cancel', {}).catch((err) =>
                    console.error('[gtasks-import] multica cancel enqueue failed(継続):', err),
                  )
                }
              }
            } else if (multicaConnectionId) {
              // 未完了の更新はmulticaへも最新スナップショットを流す(version foldされる)。
              await enqueueConnectorJob(
                multicaConnectionId,
                existingTaskId,
                'upsert',
                buildMulticaUpsertPayload(gt),
              ).catch((err) => console.error('[gtasks-import] multica upsert enqueue failed(継続):', err))
            }
          } else {
            const taskId = await createExternalTask(conn, config, gt, listId, effectiveAssignee)
            linkMap.set(gt.id, taskId) // 同一バッチ内のカーソル重複再取得を1件に畳む(冪等)
            summary.created++
            // 作成直後に既にcompleted(gt.status=completed)なタスクはmulticaへ送っても即キャンセルに
            // なるだけなのでenqueueしない。
            if (multicaConnectionId && gt.status !== 'completed') {
              await enqueueConnectorJob(multicaConnectionId, taskId, 'upsert', buildMulticaUpsertPayload(gt)).catch(
                (err) => console.error('[gtasks-import] multica upsert enqueue failed(継続):', err),
              )
            }
          }
        }
        pageToken = nextPageToken ?? undefined
      } while (pageToken)
    }
  } catch (err) {
    // 一時失敗はカーソルを進めず次回再試行(取りこぼさない)。
    console.error('[gtasks-import] import failed, cursor not advanced:', err)
    summary.skipped++
    return
  }

  // AI秘書 Stage5 期限リマインド(PR-0・§4.3/§6): last_import_success_at は poll_cursor と
  // 「全ページ取得成功後にのみ」同じ成功パスで前進させる(部分失敗ではどちらも進めない)。
  // これが接続単位の鮮度証明(sender送信直前ガード条件3)の生命線。poll_cursor と同じ理由(タイムスタンプ
  // カーソル用途)で toISOString() 使用の例外とする(ローカル日付表示ではない)。
  const { error: cursorErr } = await admin()
    .from('integration_connections')
    .update({ poll_cursor: nextCursor, last_import_success_at: new Date().toISOString() })
    .eq('id', conn.id)
  if (cursorErr) {
    console.error('[gtasks-import] cursor 更新に失敗(次回同範囲を再処理):', cursorErr)
    summary.skipped++
  }
}

/** gtasks import を1バッチ実行する。cron 起動配線は後続PR(このワーカーは呼び出されるだけ)。 */
export async function importGoogleTasksBatch(): Promise<ImportSummary> {
  const summary: ImportSummary = { connections: 0, created: 0, updated: 0, completed: 0, skipped: 0 }

  const { data: conns, error } = await admin()
    .from('integration_connections')
    .select('id, org_id, import_config, poll_cursor')
    .eq('provider', 'google_tasks')
    .eq('import_enabled', true)
    .eq('status', 'active')
  if (error) {
    console.error('[gtasks-import] connection fetch failed:', error)
    return summary
  }
  const list = (conns as ConnRow[] | null) ?? []
  summary.connections = list.length

  for (const conn of list) {
    await importConnection(conn, summary)
  }
  return summary
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { CONNECTOR_SYSTEM_USER_ID } from '@/lib/connectors/systemUser'
import type { ImportTargets, TaskSyncStore } from '@/lib/task-sync/engine'
import type { ExternalTask } from '@/lib/task-sync/types'

/**
 * TaskSyncStore の Supabase 実装。エンジン（engine.ts）が使う永続化操作を、既存 connector 層の
 * テーブル（connector_task_links）と RPC（rpc_connector_complete_task）に落とす。
 *
 * ここは既存 `src/lib/google-tasks/import.ts` が実地で獲得した不変条件を**そのまま引き継ぐ**場所:
 *   - description は NOT NULL default ''。明示 null を入れると NOT NULL 違反で update が throw し、
 *     カーソルが前進しないまま同じバッチを永久リトライして取り込みが恒久停止する。
 *   - 対応表の一意制約違反(23505)は「並行実行で先に作られた」ケース。今作ったタスクを補償削除して
 *     既存の対応へ倒す（重複タスクを残さない）。
 *   - 完了の吸収は rpc_connector_complete_task（条件付き更新）。既に done なら0件で、tasks トリガーも
 *     発火せず反響が物理的に止まる。
 *   - 外部由来タスクは client_scope='internal'（顧客ポータルに露出させない）。created_by は
 *     専用システムユーザー（実ユーザー名義にしない）。
 *
 * これらを各アダプタに書かせないための集約点であり、アダプタからDBを触らせない理由でもある。
 */

export interface TaskSyncStoreOptions {
  admin: SupabaseClient
  /** 取り込み先の org（クロステナント検証済みであること）。 */
  orgId: string
  /**
   * この接続を取り込んだタスクの「期限の正本」にするか。
   * 期限を取り込むコネクタ（capabilities.dueImport）のみ true。true のとき tasks に
   * due_authority_connection_id を立て、TaskApp 側からの期限編集を禁じる（DBトリガーが強制）。
   */
  dueAuthority: boolean
}

export function createTaskSyncStore(opts: TaskSyncStoreOptions): TaskSyncStore {
  const { admin, orgId, dueAuthority } = opts

  return {
    async loadLinks(connectionId: string): Promise<Map<string, string>> {
      const { data, error } = await admin
        .from('connector_task_links')
        .select('task_id, external_id')
        .eq('connection_id', connectionId)
        .eq('state', 'active')
      if (error) throw new Error(`loadLinks failed: ${error.message}`)
      const map = new Map<string, string>()
      for (const row of (data as Array<{ task_id: string; external_id: string }> | null) ?? []) {
        map.set(row.external_id, row.task_id)
      }
      return map
    },

    async createLinkedTask({ connectionId, task, targets, assigneeId }): Promise<string> {
      const { data: created, error: insErr } = await admin
        .from('tasks')
        .insert({
          org_id: orgId,
          space_id: targets.targetSpaceId,
          title: task.title.trim() || '(無題)',
          // NOT NULL default '' のため明示 null を入れない（入れると取り込みが恒久停止する）。
          description: task.body ?? '',
          due_date: task.dueDate,
          status: task.completed ? 'done' : 'todo',
          // ball/origin は TaskApp の「次に誰が動くか」概念。外部のタスク管理ツールは自社の道具
          // なので社内発・社内ボールとして取り込む（クライアント起票ではない）。
          ball: 'internal',
          origin: 'internal',
          // 既定は 'deliverable'。外部由来タスクが顧客ポータルへ露出しないよう internal を明示する。
          client_scope: 'internal',
          type: 'task',
          assignee_id: assigneeId,
          // 期限を取り込むコネクタでは、この接続を期限の正本にする（TaskApp側からの編集を禁じる）。
          due_authority_connection_id: dueAuthority ? connectionId : null,
          // NOT NULL。外部起票に対応する対話ユーザーは居ないため専用システムユーザー名義にする。
          created_by: CONNECTOR_SYSTEM_USER_ID,
        })
        .select('id')
        .single()
      if (insErr || !created) throw new Error(`create task failed: ${insErr?.message}`)
      const taskId = (created as { id: string }).id

      const { error: linkErr } = await admin.from('connector_task_links').insert({
        connection_id: connectionId,
        task_id: taskId,
        external_id: task.externalId,
        external_list_id: task.containerId,
        origin: 'external',
      })
      if (linkErr) {
        if ((linkErr as { code?: string }).code === '23505') {
          // 対応が既に存在する。原因は2つあり、どちらもここで吸収する:
          //   (1) 並行実行で先に作られた
          //   (2) 過去に外部で削除(orphaned)され、その後**復活**した。loadLinks は active しか
          //       読まないため未リンク扱いになり、ここへ来る。
          // (2) を放置すると毎回「作る→一意違反→補償削除」を繰り返し、生きている外部タスクが
          // 永久に切り離されたままになる。**対応を active に戻して**既存タスクへ倒す。
          const { data: existing, error: lookupErr } = await admin
            .from('connector_task_links')
            .select('task_id')
            .eq('connection_id', connectionId)
            .eq('external_id', task.externalId)
            .maybeSingle()
          // 補償削除の失敗は放置すると「対応の無い孤児タスク」が残るので、必ず結果を見る。
          const { error: delErr } = await admin.from('tasks').delete().eq('id', taskId)
          if (delErr) throw new Error(`compensating delete failed: ${delErr.message}`)
          if (lookupErr) throw new Error(`existing link lookup failed: ${lookupErr.message}`)
          if (existing) {
            const existingTaskId = (existing as { task_id: string }).task_id
            const { error: reviveErr } = await admin
              .from('connector_task_links')
              .update({
                state: 'active',
                // 外部側で入れ物が変わっている可能性がある（別プロジェクトへ移動して復活等）。
                external_list_id: task.containerId,
                updated_at: new Date().toISOString(),
              })
              .eq('connection_id', connectionId)
              .eq('external_id', task.externalId)
            if (reviveErr) throw new Error(`revive link failed: ${reviveErr.message}`)

            // 復活したタスクは、対応を戻すだけでは中身が**削除時点のまま**残る。次のサイクルまで
            // 古い期限・古いタイトルが正しいものとして扱われる（低頻度ポーリングのツールなら
            // 丸一日）。同じ取り込みの中で現在のスナップショットへ更新し、期限の正本も戻す
            // （orphaned 化のときに外しているため）。
            const { error: refreshErr } = await admin
              .from('tasks')
              .update({
                title: task.title.trim() || '(無題)',
                description: task.body ?? '',
                due_date: task.dueDate,
                due_authority_connection_id: dueAuthority ? connectionId : null,
              })
              .eq('id', existingTaskId)
            if (refreshErr) throw new Error(`refresh revived task failed: ${refreshErr.message}`)
            return existingTaskId
          }
        }
        throw new Error(`create link failed: ${linkErr.message}`)
      }
      return taskId
    },

    async updateLinkedTask(taskId: string, task: ExternalTask): Promise<void> {
      const { error } = await admin
        .from('tasks')
        .update({
          title: task.title.trim() || '(無題)',
          description: task.body ?? '', // NOT NULL default ''（上と同じ理由）
          due_date: task.dueDate,
        })
        .eq('id', taskId)
      if (error) throw new Error(`update task failed: ${error.message}`)
    },

    async completeLinkedTask(connectionId: string, taskId: string): Promise<boolean> {
      // 条件付き更新。既に done なら0件で false が返り、トリガーも発火しない＝ループが物理停止する。
      const { data, error } = await admin.rpc('rpc_connector_complete_task', {
        p_connection_id: connectionId,
        p_task_id: taskId,
      })
      if (error) throw new Error(`rpc_connector_complete_task failed: ${error.message}`)
      return data === true
    },

    async markLinkOrphaned(connectionId: string, externalId: string): Promise<void> {
      // 対応を切る前に task_id を控える。期限の正本を外すのに必要（下記）。
      const { data: link, error: lookupErr } = await admin
        .from('connector_task_links')
        .select('task_id')
        .eq('connection_id', connectionId)
        .eq('external_id', externalId)
        .maybeSingle()
      if (lookupErr) throw new Error(`markLinkOrphaned lookup failed: ${lookupErr.message}`)

      // タスク行は消さない（作業の記録と証跡は残す）。対応だけ切って以後の更新対象から外す。
      const { error } = await admin
        .from('connector_task_links')
        .update({ state: 'orphaned', updated_at: new Date().toISOString() })
        .eq('connection_id', connectionId)
        .eq('external_id', externalId)
      if (error) throw new Error(`markLinkOrphaned failed: ${error.message}`)

      if (link) {
        // **期限の正本を外す**。外さないと、外部で消えたタスクの古い期限が残ったまま接続は
        // 「同期成功」なので鮮度証明を満たし、AI秘書が「もう存在しないタスク」について相手を
        // 催促してしまう（送るべきでないものを送る＝一番やってはいけない誤爆）。
        const { error: authErr } = await admin
          .from('tasks')
          .update({ due_authority_connection_id: null })
          .eq('id', (link as { task_id: string }).task_id)
        if (authErr) throw new Error(`clear due authority failed: ${authErr.message}`)
      }
    },

    async saveCursor(connectionId: string, cursor: string | null, succeededAt: Date): Promise<void> {
      // poll_cursor と last_import_success_at は**同じ成功パスでのみ**前進させる。
      // last_import_success_at は AI秘書の期限リマインドが「この接続の期限情報は N 分以内に
      // 同期済み」と主張するための鮮度証明であり、部分成功で進めると嘘の鮮度を主張してしまう。
      // タイムスタンプ用途のため toISOString を使う（ローカル日付表示ではないので禁止対象外）。
      const { error } = await admin
        .from('integration_connections')
        .update({ poll_cursor: cursor, last_import_success_at: succeededAt.toISOString() })
        .eq('id', connectionId)
      if (error) throw new Error(`saveCursor failed: ${error.message}`)
    },
  }
}

/**
 * 取り込み先（space / 既定担当者）が接続の org に属するかを検証する。
 *
 * ワーカーは service_role で RLS をバイパスし、space の org 不整合は tasks トリガーも検査しない。
 * 誤設定や悪意ある import_config で**別orgのスペースにタスク行を作らせない**ための境界であり、
 * DBの書込時検証トリガーがあってもなお必要（トリガーは書込時点しか見ず、設定後に space の
 * 帰属や担当者のメンバーシップが変わる drift を防げない。実行時検証が真の境界）。
 */
export async function validateImportTargets(
  admin: SupabaseClient,
  orgId: string,
  targets: ImportTargets,
): Promise<{ ok: boolean; assigneeId: string | null; reason?: string }> {
  if (!targets.targetSpaceId) return { ok: false, assigneeId: null, reason: 'target_space_unset' }

  const { data: space, error } = await admin
    .from('spaces')
    .select('org_id')
    .eq('id', targets.targetSpaceId)
    .maybeSingle()
  if (error) throw new Error(`validateImportTargets space lookup failed: ${error.message}`)
  if (!space || (space as { org_id: string }).org_id !== orgId) {
    // 別orgのスペースが指定されている。取り込み自体を止める（1件も作らせない）。
    return { ok: false, assigneeId: null, reason: 'space_org_mismatch' }
  }

  let assigneeId = targets.defaultAssigneeId ?? null
  if (assigneeId) {
    const { data: member, error: memErr } = await admin
      .from('org_memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', assigneeId)
      .maybeSingle()
    if (memErr) throw new Error(`validateImportTargets membership lookup failed: ${memErr.message}`)
    // メンバー外なら担当を外して継続する（取り込み自体は止めない。担当は後から直せる）。
    if (!member) assigneeId = null
  }
  return { ok: true, assigneeId }
}

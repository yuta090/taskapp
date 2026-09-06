/**
 * Sample task creation — shared by create-with-preset route.
 *
 * Presets ship with a few sample tasks so the landing screen after onboarding
 * isn't empty ("タスクはありません"). Milestone ids are unknown until the RPC
 * has created them, so this runs after space creation and resolves
 * milestoneName -> id by querying the space's milestones.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PresetDefinition, PresetSampleTask } from './index'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * サンプルタスクに同梱する「使い方ガイド」の話題。
 * 各プリセットの4件は同じ型（相手先ボール / 期限付き / 着手前 / 編集練習）で並ぶので、
 * ジャンル側に項目を足さずタスクの性質から決める（inferHelpTopic）。
 */
export type SampleHelpTopic = 'ball' | 'schedule' | 'status' | 'edit'

export function inferHelpTopic(task: PresetSampleTask, index: number, all: PresetSampleTask[]): SampleHelpTopic {
  if (task.ball === 'client') return 'ball'
  if (task.dueInDays !== undefined) return 'schedule'
  // 着手前(backlog)が2件以上あるときは、最初の1件を「ステータス」、残りを「編集」の話題にする
  const firstBacklog = all.findIndex((t) => t.ball !== 'client' && t.dueInDays === undefined && t.status === 'backlog')
  if (task.status === 'backlog' && firstBacklog === index) return 'status'
  return 'edit'
}

const HELP_HEADER = '━━ 使い方ガイド ━━\n（このタスクはサンプルです。読み終わったら自由に編集・削除できます）'
const HELP_FOOTER = 'もっと詳しく: 画面左下の「ヘルプ」→「使い方マニュアル」'

const HELP_BY_TOPIC: Record<SampleHelpTopic, string> = {
  ball: [
    '■ ボール（次に動く番）',
    'ボールは「次に誰が動く番か」を表します。このタスクはいま相手先（クライアント）にボールがあり、一覧ではアンバー色の「クライアント確認待ち」として目立ちます。',
    '',
    '■ やってみる',
    '1. このパネル上部の「ボール」で「社内」を選ぶと、こちらの番に戻ります。',
    '2. 相手先に確認をお願いするときは、逆に「相手先」へ渡します。',
    '3. 一覧の「クライアント確認待ち」フィルタで、相手先の返事待ちだけを絞り込めます。',
  ].join('\n'),
  schedule: [
    '■ 期限とマイルストーン',
    'このタスクには期限日とマイルストーン（大きな区切り）が付いています。期限が近づくと、担当者にリマインドが届きます。',
    '',
    '■ やってみる',
    '1. 「期限」をクリックして日付を変えてみてください。保存ボタンはなく、その場で反映されます。',
    '2. 上のタブ「ガント」を開くと、期限とマイルストーンが線で見えます。',
    '3. 「ステータス」を変えると一覧にも即座に反映されます。',
  ].join('\n'),
  status: [
    '■ ステータス（進み具合）',
    'このタスクはまだ着手前（未整理）です。ステータスは「未整理 → 未着手 → 進行中 → 確認待ち → 完了」と進みます。',
    '',
    '■ やってみる',
    '1. 一覧で左端の丸いアイコンをクリックすると「進行中」に変わります。',
    '2. ステータスは「進み具合」、ボールは「次に動く人」。別々に管理します。',
    '3. 「完了」にすると一覧の下に移り、完了日が記録されます。',
  ].join('\n'),
  edit: [
    '■ タスクの編集',
    'このパネル（右側）で担当者・期限・説明文を編集できます。どれも保存ボタンはなく、その場で反映されます。',
    '',
    '■ やってみる',
    '1. 「担当者」を自分に変えてみてください。',
    '2. 説明文をクリックして書き換えてみてください。',
    '3. 「相手先に見せる」をONにすると、相手先のポータルにこのタスクが表示されます（一覧ではアンバー色）。',
    '4. 練習が終わったら、一覧上部の「サンプルタスクが含まれています」から一括削除できます。',
  ].join('\n'),
}

/** サンプルの説明文に「使い方ガイド」を付け足す（元の説明は先頭にそのまま残す）。 */
export function buildSampleDescription(task: PresetSampleTask, topic: SampleHelpTopic): string {
  return [task.description.trim(), '', HELP_HEADER, '', HELP_BY_TOPIC[topic], '', HELP_FOOTER].join('\n')
}

/**
 * Insert the preset's sample tasks into a newly created space.
 * Best-effort: never throws — logs and returns the number actually created,
 * so a failure here doesn't break the (already-succeeded) space creation response.
 */
export async function createSampleTasks(
  supabase: SupabaseClient,
  preset: PresetDefinition,
  orgId: string,
  spaceId: string,
  createdBy: string,
): Promise<number> {
  if (preset.sampleTasks.length === 0) return 0

  try {
    const { data: milestoneRows, error: milestoneError } = await supabase
      .from('milestones')
      .select('id, name')
      .eq('space_id', spaceId)

    if (milestoneError) throw milestoneError

    const milestoneIdByName = new Map<string, string>(
      ((milestoneRows ?? []) as { id: string; name: string }[]).map((m) => [m.name, m.id]),
    )

    const now = new Date()
    const rows = preset.sampleTasks.map((task, index) => {
      let dueDate: string | null = null
      if (task.dueInDays !== undefined) {
        const due = new Date(now)
        due.setDate(due.getDate() + task.dueInDays)
        dueDate = formatDateToLocalString(due)
      }

      return {
        org_id: orgId,
        space_id: spaceId,
        milestone_id: task.milestoneName ? milestoneIdByName.get(task.milestoneName) ?? null : null,
        title: task.title,
        // サンプルを開くと使い方が読めるよう、説明文にガイドを同梱する（「はじめての設定」と役割を分ける）
        description: buildSampleDescription(task, inferHelpTopic(task, index, preset.sampleTasks)),
        status: task.status,
        ball: task.ball,
        origin: 'internal' as const,
        type: 'task' as const,
        client_scope: task.clientScope,
        due_date: dueDate,
        is_sample: true,
        created_by: createdBy,
      }
    })

    const { error: insertError } = await supabase.from('tasks').insert(rows)
    if (insertError) throw insertError

    return rows.length
  } catch (err) {
    console.error('[preset] Sample task creation failed:', err)
    return 0
  }
}

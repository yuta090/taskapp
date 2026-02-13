/**
 * 監査ログ記録ユーティリティ
 *
 * 全操作履歴を audit_logs テーブルに記録する共通関数
 */

import { SupabaseClient } from '@supabase/supabase-js'

// イベントタイプの定義
export type AuditEventType =
  // タスク関連
  | 'task.created'
  | 'task.updated'
  | 'task.status_changed'
  | 'task.ball_moved'
  | 'task.deleted'
  // コメント関連
  | 'comment.added'
  | 'comment.edited'
  | 'comment.deleted'
  // 承認関連
  | 'approval.approved'
  | 'approval.changes_requested'
  // マイルストーン関連
  | 'milestone.created'
  | 'milestone.updated'
  | 'milestone.completed'
  | 'milestone.deleted'
  // レビュー関連
  | 'review.started'
  | 'review.approved'
  | 'review.rejected'
  // ミーティング関連
  | 'meeting.created'
  | 'meeting.started'
  | 'meeting.ended'
  | 'meeting.minutes_parsed'
  // メンバー関連
  | 'member.invited'
  | 'member.joined'
  | 'member.removed'
  | 'member.role_changed'
  // その他
  | 'export.created'
  | 'api_key.created'
  | 'api_key.deleted'

// ターゲットタイプの定義
export type AuditTargetType =
  | 'task'
  | 'comment'
  | 'milestone'
  | 'meeting'
  | 'member'
  | 'review'
  | 'export'
  | 'api_key'

// 表示制御
export type AuditVisibility = 'client' | 'team'

// ユーザーロール
export type AuditActorRole = 'client' | 'owner' | 'member'

/**
 * 監査ログ作成パラメータ
 */
export interface CreateAuditLogParams {
  supabase: SupabaseClient
  orgId: string
  spaceId: string
  actorId: string
  actorRole: AuditActorRole
  eventType: AuditEventType
  targetType: AuditTargetType
  targetId: string
  summary?: string
  dataBefore?: Record<string, unknown>
  dataAfter?: Record<string, unknown>
  metadata?: Record<string, unknown>
  visibility?: AuditVisibility
}

/**
 * 監査ログを作成する
 *
 * @example
 * ```typescript
 * await createAuditLog({
 *   supabase,
 *   orgId: task.org_id,
 *   spaceId: task.space_id,
 *   actorId: user.id,
 *   actorRole: 'client',
 *   eventType: 'approval.approved',
 *   targetType: 'task',
 *   targetId: task.id,
 *   summary: 'タスクを承認しました',
 *   dataBefore: { status: 'considering', ball: 'client' },
 *   dataAfter: { status: 'done', ball: 'internal' },
 *   visibility: 'client',
 * })
 * ```
 */
export async function createAuditLog({
  supabase,
  orgId,
  spaceId,
  actorId,
  actorRole,
  eventType,
  targetType,
  targetId,
  summary,
  dataBefore,
  dataAfter,
  metadata,
  visibility = 'team',
}: CreateAuditLogParams): Promise<{ success: boolean; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('audit_logs')
      .insert({
        org_id: orgId,
        space_id: spaceId,
        actor_id: actorId,
        actor_role: actorRole,
        event_type: eventType,
        target_type: targetType,
        target_id: targetId,
        summary,
        data_before: dataBefore || null,
        data_after: dataAfter || null,
        metadata: metadata || null,
        visibility,
        occurred_at: new Date().toISOString(),
      })

    if (error) {
      console.error('[AuditLog] Failed to create audit log:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error('[AuditLog] Exception creating audit log:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * イベントタイプに基づいてデフォルトの visibility を取得
 */
export function getDefaultVisibility(eventType: AuditEventType): AuditVisibility {
  // クライアントに表示するイベント
  const clientVisibleEvents: AuditEventType[] = [
    'task.status_changed',
    'task.ball_moved',
    'approval.approved',
    'approval.changes_requested',
    'milestone.created',
    'milestone.updated',
    'milestone.completed',
    'meeting.created',
    'meeting.started',
    'meeting.ended',
    'member.joined',
  ]

  return clientVisibleEvents.includes(eventType) ? 'client' : 'team'
}

/**
 * イベントタイプに基づいてサマリーテキストを生成
 */
export function generateAuditSummary(
  eventType: AuditEventType,
  context?: { title?: string; name?: string }
): string {
  const targetName = context?.title || context?.name || ''

  const summaryMap: Record<AuditEventType, string> = {
    // タスク
    'task.created': targetName ? `タスク「${targetName}」を作成しました` : 'タスクを作成しました',
    'task.updated': targetName ? `タスク「${targetName}」を更新しました` : 'タスクを更新しました',
    'task.status_changed': 'ステータスを変更しました',
    'task.ball_moved': 'ボールを移動しました',
    'task.deleted': targetName ? `タスク「${targetName}」を削除しました` : 'タスクを削除しました',
    // コメント
    'comment.added': 'コメントを追加しました',
    'comment.edited': 'コメントを編集しました',
    'comment.deleted': 'コメントを削除しました',
    // 承認
    'approval.approved': targetName ? `「${targetName}」を承認しました` : 'タスクを承認しました',
    'approval.changes_requested': targetName ? `「${targetName}」に修正を依頼しました` : '修正を依頼しました',
    // マイルストーン
    'milestone.created': targetName ? `マイルストーン「${targetName}」を作成しました` : 'マイルストーンを作成しました',
    'milestone.updated': targetName ? `マイルストーン「${targetName}」を更新しました` : 'マイルストーンを更新しました',
    'milestone.completed': targetName ? `マイルストーン「${targetName}」が完了しました` : 'マイルストーンが完了しました',
    'milestone.deleted': targetName ? `マイルストーン「${targetName}」を削除しました` : 'マイルストーンを削除しました',
    // レビュー
    'review.started': 'レビューを開始しました',
    'review.approved': 'レビューを承認しました',
    'review.rejected': 'レビューを差し戻しました',
    // ミーティング
    'meeting.created': targetName ? `会議「${targetName}」を作成しました` : '会議を作成しました',
    'meeting.started': '会議を開始しました',
    'meeting.ended': '会議が終了しました',
    'meeting.minutes_parsed': '議事録を解析しました',
    // メンバー
    'member.invited': 'メンバーを招待しました',
    'member.joined': 'メンバーが参加しました',
    'member.removed': 'メンバーを削除しました',
    'member.role_changed': '役割を変更しました',
    // その他
    'export.created': 'データをエクスポートしました',
    'api_key.created': 'APIキーを作成しました',
    'api_key.deleted': 'APIキーを削除しました',
  }

  return summaryMap[eventType] || eventType
}

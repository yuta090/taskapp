import { UNKNOWN_PROFILE_LABEL } from '@/lib/labels'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { buildProjectBasePath, buildWikiPageHref } from '@/lib/navigation/appLinks'

/**
 * ダッシュボードの「最近のアクティビティ」。DB 関数 rpc_space_activity が返す1行を、
 * 「誰が・何をした・対象・リンク先」に変える。kind の一覧は
 * supabase/migrations/20261126013321_space_activity_feed.sql のコメントが正本。
 */

export interface ActivityRow {
  /** change_log の行番号。1回の更新で状態とボールが両方変わると同じ id で kind だけ違う行が出る */
  id: number
  occurred_at: string
  actor_user_id: string | null
  /** 'app' | 'cli' | 'mcp' | 'portal' など。操作の入口 */
  channel: string
  kind: string
  target_id: string | null
  task_id: string | null
  title: string | null
  detail: Record<string, unknown> | null
}

export interface ActivityView {
  /** 一覧の key。id だけだと状態とボールを同時に変えた行が重なる */
  key: string
  who: string
  /** CLI・AI 経由のときだけ入る小さなラベル */
  channelLabel: 'CLI' | 'AI' | null
  action: string
  /** コメントの抜粋（1行にしたもの） */
  excerpt: string | null
  target: string
  /** 開く先。削除した物・タスクの無い行は null */
  href: string | null
  occurredAt: string
}

export interface ActivityContext {
  orgId: string
  spaceId: string
  /** user_id → 表示名（useSpaceMembers の名簿） */
  nameById: ReadonlyMap<string, string>
}

export const NO_TITLE_LABEL = '（題名なし）'
const SYSTEM_LABEL = 'システム'

// タスクの状態の表示名。タスク詳細（TaskInspector）の選択肢と同じ言葉にそろえる
const STATUS_LABELS: Record<string, string> = {
  backlog: '未着手',
  todo: '着手予定',
  in_progress: '進行中',
  in_review: '社内承認中',
  done: '完了',
  considering: '検討中',
}

function statusLabel(value: unknown): string {
  return typeof value === 'string' ? (STATUS_LABELS[value] ?? value) : '不明'
}

function oneLine(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

function actionOf(row: ActivityRow, ctx: ActivityContext): string {
  const detail = row.detail ?? {}
  switch (row.kind) {
    case 'task_created':
      return 'タスクを作成'
    case 'task_completed':
      return 'タスクを完了'
    case 'task_status':
      return typeof detail.from === 'string' && typeof detail.to === 'string'
        ? `状態を${statusLabel(detail.from)}→${statusLabel(detail.to)}に変更`
        : '状態を変更'
    case 'task_ball':
      if (detail.to === 'internal') return 'ボールを社内へ'
      if (detail.to === 'client') return 'ボールをクライアントへ'
      return 'ボールを変更'
    case 'task_assignee': {
      const to = detail.to
      const name = typeof to === 'string' ? (ctx.nameById.get(to) ?? UNKNOWN_PROFILE_LABEL) : '担当なし'
      return `担当者を${name}に変更`
    }
    case 'task_deleted':
      return 'タスクを削除'
    case 'comment_added':
      return 'コメント'
    case 'file_uploaded':
      return 'ファイルをアップロード'
    case 'file_deleted':
      return 'ファイルを削除'
    case 'wiki_created':
      return 'Wiki ページを作成'
    case 'wiki_edited':
      return 'Wiki ページを編集'
    case 'wiki_deleted':
      return 'Wiki ページを削除'
    case 'review_approved':
      return '承認'
    case 'review_changes_requested':
      return '差し戻し'
    default:
      return '操作'
  }
}

function hrefOf(row: ActivityRow, ctx: ActivityContext): string | null {
  switch (row.kind) {
    case 'task_created':
    case 'task_completed':
    case 'task_status':
    case 'task_ball':
    case 'task_assignee':
    case 'comment_added':
    case 'review_approved':
    case 'review_changes_requested':
      return row.task_id ? buildTaskDeepLink(ctx.orgId, ctx.spaceId, row.task_id) : null
    case 'wiki_created':
    case 'wiki_edited':
      return row.target_id ? buildWikiPageHref(ctx.orgId, ctx.spaceId, row.target_id) : null
    case 'file_uploaded':
      return `${buildProjectBasePath(ctx.orgId, ctx.spaceId)}/files`
    default:
      // 削除した物（task_deleted / file_deleted / wiki_deleted）と知らない種類には開く先が無い
      return null
  }
}

export function describeActivity(row: ActivityRow, ctx: ActivityContext): ActivityView {
  const who =
    row.actor_user_id === null ? SYSTEM_LABEL : (ctx.nameById.get(row.actor_user_id) ?? UNKNOWN_PROFILE_LABEL)
  return {
    key: `${row.id}:${row.kind}`,
    who,
    channelLabel: row.channel === 'cli' ? 'CLI' : row.channel === 'mcp' ? 'AI' : null,
    action: actionOf(row, ctx),
    excerpt: row.kind === 'comment_added' ? oneLine(row.detail?.excerpt) : null,
    target: row.title ?? NO_TITLE_LABEL,
    href: hrefOf(row, ctx),
    occurredAt: row.occurred_at,
  }
}

/** 読み込みに失敗した理由。forbidden は社内メンバー以外が開いたとき（DB 関数が Not authorized を返す） */
export type ActivityFailureKind = 'forbidden' | 'failed'

export function activityFailureKind(error: unknown): ActivityFailureKind | null {
  if (error == null) return null
  const message = typeof error === 'object' && 'message' in error ? (error as { message?: unknown }).message : null
  return typeof message === 'string' && message.includes('Not authorized') ? 'forbidden' : 'failed'
}

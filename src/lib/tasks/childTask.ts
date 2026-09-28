/**
 * タスク詳細から子タスクを作るときの中身を1か所で決める。
 *
 * 運用ルール「確認依頼は子タスクで出す」（2026-09-15 確定）に合わせている:
 * - 確認依頼は、作業タスクの子として立てる（説明欄にリンクを貼らず、親子で紐づける）
 * - 題名は作業の名前ではなく「確認依頼: <結論そのもの>」
 * - 担当は作業タスク（親）の担当者のまま。承認者を担当にしない
 * - 説明欄は [なぜ] [影響] [根拠] [様子見] の4行だけ書く
 */
import type { CreateTaskInput } from '@/lib/hooks/useTasks'
import type { Task } from '@/types/database'

/** 確認依頼タスクの題名の書き出し。続きに結論そのものを書く */
export const REVIEW_REQUEST_TITLE_PREFIX = '確認依頼: '

/** 確認依頼タスクの説明欄のひな形。これ以上は書かない */
export const REVIEW_REQUEST_DESCRIPTION_TEMPLATE = [
  '[なぜ] ',
  '[影響] ',
  '[根拠] ',
  '[様子見] ',
].join('\n')

export interface ChildTaskDraft {
  title: string
  description?: string
}

/**
 * 親タスクと入力内容から、子タスクを作るための入力を組み立てる。
 *
 * ボールは親から引き継がず、必ず社内・非公開にする。相手先に出す子タスクは
 * ボールを渡す相手（clientOwnerIds）が要るため、その場の1行入力では決められない。
 */
export function buildChildTaskInput(parent: Task, draft: ChildTaskDraft): CreateTaskInput {
  const title = draft.title.trim()
  const description = draft.description?.trim()

  return {
    title,
    description: description || undefined,
    type: 'task',
    ball: 'internal',
    origin: 'internal',
    clientScope: 'internal',
    clientOwnerIds: [],
    internalOwnerIds: [],
    assigneeId: parent.assignee_id ?? undefined,
    parentTaskId: parent.id,
  }
}

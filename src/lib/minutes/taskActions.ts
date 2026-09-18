/**
 * 議事録の「タスク作成済み」の印から、その場でできることを決める。
 *
 * 会議中に「これ終わったね」となったとき、議事録でチェックを入れる動きが自然だが、
 * `- [x]` にしてもタスクは動かない（見た目だけ変わるので、完了したと思い込む）。
 * かといってチェックと完了を連動させると「外したら完了を取り消すのか」など決めることが
 * 増えて事故りやすい。そこで**印を押したら操作を選べる**形にする。
 *
 * 出すボタンは、そのタスクの状態で変わる。押せないものは出さない
 * （押してから断られるより、最初から出ないほうが分かりやすい）。
 */

import type { DecisionState, TaskStatus, TaskType } from '@/types/database'

export interface MinutesTaskState {
  status: TaskStatus
  type: TaskType
  decisionState: DecisionState | null
  /** 社内承認が付いていて、まだ承認されていないか */
  reviewPending: boolean
}

export type MinutesTaskAction = 'decide' | 'complete' | 'open'

export interface MinutesTaskActionItem {
  action: MinutesTaskAction
  label: string
  /** 押せないときの理由。null なら押せる */
  disabledReason: string | null
}

/** 状態を人の言葉にする（画面のタスク行と同じ言い回し） */
export function taskStateLabel(state: MinutesTaskState): string {
  if (state.status === 'done') return '完了'
  if (state.type === 'spec') {
    if (state.decisionState === 'considering') return '検討中'
    if (state.decisionState === 'decided') return '決定済み'
    if (state.decisionState === 'implemented') return '実装済み'
  }
  if (state.status === 'in_review') return '社内承認中'
  if (state.status === 'in_progress') return '進行中'
  if (state.status === 'considering') return '検討中'
  if (state.status === 'todo') return '未着手'
  return '未着手'
}

export function buildMinutesTaskActions(state: MinutesTaskState): MinutesTaskActionItem[] {
  const items: MinutesTaskActionItem[] = []

  // 決定事項のタスクで、まだ決まっていないときだけ「決定にする」を出す。
  // 決めるのは人なので、完了より先にこちらを出す。
  if (state.type === 'spec' && state.decisionState === 'considering' && state.status !== 'done') {
    items.push({ action: 'decide', label: '決定にする', disabledReason: null })
  }

  if (state.status !== 'done') {
    // 完了できない条件は DB 側（enforce_review_gate）と同じ。押してから断られるのではなく、
    // 理由を添えて最初から押せないようにする
    let reason: string | null = null
    if (state.type === 'spec' && state.decisionState === 'considering') {
      reason = '先に「決定にする」を押してください'
    } else if (state.reviewPending) {
      reason = '社内承認が終わっていません'
    }
    items.push({ action: 'complete', label: '完了にする', disabledReason: reason })
  }

  items.push({ action: 'open', label: 'タスクを開く', disabledReason: null })
  return items
}

/**
 * 完了にできなかった理由の言い換えは、受信トレイ・マイタスクとも同じ文を出すため
 * `@/lib/tasks/completeFailure` に置いている。ここからも今までどおり読めるよう再公開する。
 */
export {
  classifyCompleteFailure,
  completeFailureMessage,
  COMPLETE_FAILURE_NO_ROWS,
} from '@/lib/tasks/completeFailure'
export type { CompleteFailureKind } from '@/lib/tasks/completeFailure'

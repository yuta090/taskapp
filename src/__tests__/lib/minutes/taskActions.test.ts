import { describe, it, expect } from 'vitest'
import {
  buildMinutesTaskActions,
  taskStateLabel,
  type MinutesTaskState,
} from '@/lib/minutes/taskActions'

const state = (over: Partial<MinutesTaskState> = {}): MinutesTaskState => ({
  status: 'todo',
  type: 'task',
  decisionState: null,
  reviewPending: false,
  ...over,
})

const actions = (s: MinutesTaskState) => buildMinutesTaskActions(s).map((a) => a.action)
const find = (s: MinutesTaskState, a: string) =>
  buildMinutesTaskActions(s).find((i) => i.action === a)

describe('buildMinutesTaskActions: ふつうのタスク', () => {
  it('未完了なら「完了にする」と「開く」', () => {
    expect(actions(state())).toEqual(['complete', 'open'])
    expect(find(state(), 'complete')?.disabledReason).toBeNull()
  })

  it('完了済みなら「開く」だけ', () => {
    expect(actions(state({ status: 'done' }))).toEqual(['open'])
  })

  it('社内承認が終わっていなければ、理由を添えて押せなくする', () => {
    const s = state({ status: 'in_review', reviewPending: true })
    expect(find(s, 'complete')?.disabledReason).toBe('社内承認が終わっていません')
  })

  it('承認が済んでいれば押せる', () => {
    const s = state({ status: 'in_review', reviewPending: false })
    expect(find(s, 'complete')?.disabledReason).toBeNull()
  })
})

describe('buildMinutesTaskActions: 決定事項のタスク', () => {
  it('未決なら「決定にする」を先に出し、完了は押せなくする', () => {
    const s = state({ type: 'spec', decisionState: 'considering' })
    expect(actions(s)).toEqual(['decide', 'complete', 'open'])
    expect(find(s, 'complete')?.disabledReason).toBe('先に「決定にする」を押してください')
  })

  it('決定済みなら「決定にする」は出さず、完了が押せる', () => {
    const s = state({ type: 'spec', decisionState: 'decided' })
    expect(actions(s)).toEqual(['complete', 'open'])
    expect(find(s, 'complete')?.disabledReason).toBeNull()
  })

  it('実装済みでも完了が押せる', () => {
    const s = state({ type: 'spec', decisionState: 'implemented' })
    expect(find(s, 'complete')?.disabledReason).toBeNull()
  })

  it('完了済みなら「決定にする」も出さない', () => {
    const s = state({ type: 'spec', decisionState: 'considering', status: 'done' })
    expect(actions(s)).toEqual(['open'])
  })

  it('未決かつ承認待ちなら、決定のほうを理由に出す（先に決めるのが順番）', () => {
    const s = state({ type: 'spec', decisionState: 'considering', reviewPending: true })
    expect(find(s, 'complete')?.disabledReason).toBe('先に「決定にする」を押してください')
  })
})

describe('taskStateLabel', () => {
  it('完了が最優先', () => {
    expect(taskStateLabel(state({ status: 'done', type: 'spec', decisionState: 'considering' }))).toBe('完了')
  })

  it('決定事項のタスクは決定の状態で表す', () => {
    expect(taskStateLabel(state({ type: 'spec', decisionState: 'considering' }))).toBe('検討中')
    expect(taskStateLabel(state({ type: 'spec', decisionState: 'decided' }))).toBe('決定済み')
    expect(taskStateLabel(state({ type: 'spec', decisionState: 'implemented' }))).toBe('実装済み')
  })

  it('ふつうのタスクは status で表す', () => {
    expect(taskStateLabel(state({ status: 'in_review' }))).toBe('社内承認中')
    expect(taskStateLabel(state({ status: 'in_progress' }))).toBe('進行中')
    expect(taskStateLabel(state({ status: 'todo' }))).toBe('未着手')
    expect(taskStateLabel(state({ status: 'backlog' }))).toBe('未着手')
  })
})

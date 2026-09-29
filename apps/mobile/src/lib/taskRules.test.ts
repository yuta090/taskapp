import { describe, expect, it } from 'vitest'
import { STATUS_CHANGE_NO_ROWS } from '@/lib/tasks/completeFailure'
import { completionBlocker, ensureUpdated, normalizeBlockReason, STATUS_CHOICES } from './taskRules'

describe('completionBlocker', () => {
  const task = { type: 'task' as const, decision_state: null }
  it('社内承認が終わっていなければ完了にできない（DB も拒否する。先に理由を出す）', () => {
    expect(completionBlocker('open', task)).toBe('社内承認が完了するまでタスクを完了できません')
    expect(completionBlocker('changes_requested', task)).toBe('社内承認が完了するまでタスクを完了できません')
  })
  it('仕様タスクが検討中なら完了にできない', () => {
    expect(completionBlocker(undefined, { type: 'spec', decision_state: 'considering' })).toBe(
      '決定事項が未決のため完了できません'
    )
  })
  it('それ以外は完了にできる', () => {
    expect(completionBlocker('approved', task)).toBeNull()
    expect(completionBlocker(undefined, task)).toBeNull()
  })
})

describe('ensureUpdated', () => {
  it('RLS で弾かれた更新は 0 行で返ってくるので、失敗として扱う', () => {
    expect(() => ensureUpdated([])).toThrow(STATUS_CHANGE_NO_ROWS)
    expect(() => ensureUpdated(null)).toThrow()
  })
  it('1行以上更新されていれば成功', () => {
    expect(() => ensureUpdated([{ id: 't1' }])).not.toThrow()
  })
})

describe('STATUS_CHOICES', () => {
  it('スマホで切り替えられるのは「検討中」を除く状態（検討中は仕様の決定で抜ける）', () => {
    expect(STATUS_CHOICES.map((c) => c.value)).toEqual(['backlog', 'todo', 'in_progress', 'done'])
  })
})

describe('normalizeBlockReason', () => {
  it('前後の空白を除いた理由を返す（Web の TaskReviewSection と同じ）', () => {
    expect(normalizeBlockReason('  文言を直してください \n')).toBe('文言を直してください')
  })
  it('空・空白だけなら null（送らない）', () => {
    expect(normalizeBlockReason('')).toBeNull()
    expect(normalizeBlockReason('   \n ')).toBeNull()
  })
})

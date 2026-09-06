import { describe, it, expect } from 'vitest'
import { buildEmailCopy } from './core'
import { APPROVAL_PLACEHOLDERS, APPROVAL_TEMPLATE_DEFAULTS, approvalKeyFor, approvalVarsByName, formatCurrencyJpy } from './approval'

const vars = approvalVarsByName({
  taskTitle: 'ログイン画面',
  spaceName: 'ECサイト',
  orgName: 'クラフトテック',
  estimatedCostLabel: formatCurrencyJpy(160000),
  dueDateLabel: '2026/7/10',
  appName: 'AgentPM',
})

describe('approval template', () => {
  it('actionType → キー', () => {
    expect(approvalKeyFor('approve')).toBe('approval_task')
    expect(approvalKeyFor('estimate_approve')).toBe('approval_estimate')
  })

  it('既定文面は従来の件名・見出し・本文・ボタンになる', () => {
    const task = buildEmailCopy(APPROVAL_TEMPLATE_DEFAULTS.approval_task, vars)
    expect(task.subject).toBe('【AgentPM】確認をお願いします — ログイン画面')
    expect(task.heading).toBe('確認のお願い')
    expect(task.bodyParagraphs).toEqual(['「ECサイト」プロジェクトでタスクの確認をお待ちしています。'])
    expect(task.ctaLabel).toBe('内容を確認する')
    const est = buildEmailCopy(APPROVAL_TEMPLATE_DEFAULTS.approval_estimate, vars)
    expect(est.subject).toBe('【AgentPM】見積もりの確認をお願いします — ログイン画面')
    expect(est.heading).toBe('見積もりの確認')
    expect(est.ctaLabel).toBe('見積もりを確認する')
  })

  it('宣言した差し込み語は全部値に置き換わる', () => {
    const body = APPROVAL_PLACEHOLDERS.map((p) => `{{${p.name}}}`).join('|')
    const copy = buildEmailCopy({ ...APPROVAL_TEMPLATE_DEFAULTS.approval_task, body }, vars)
    expect(copy.bodyParagraphs[0]).toBe('ログイン画面|ECサイト|クラフトテック|￥160,000|2026/7/10|AgentPM')
  })

  it('formatCurrencyJpy は円表記', () => {
    expect(formatCurrencyJpy(160000)).toBe('￥160,000')
  })
})

import { describe, it, expect } from 'vitest'
import {
  buildChildTaskInput,
  REVIEW_REQUEST_TITLE_PREFIX,
  REVIEW_REQUEST_DESCRIPTION_TEMPLATE,
} from '@/lib/tasks/childTask'
import type { Task } from '@/types/database'

// 運用ルール「確認依頼は子タスクで出す」(2026-09-15 確定) をコードに落としたもの。
// - 確認依頼タスクは作業タスクの子として立てる
// - 担当は作業タスク（親）の担当者のまま。承認者（レビュアー）を担当にしない
// - 説明欄は [なぜ] [影響] [根拠] [様子見] の4行

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'parent-1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: '粗利の下限を整理する',
    description: null,
    status: 'in_progress',
    priority: null,
    assignee_id: 'user-takahashi',
    start_date: null,
    due_date: null,
    ball: 'client',
    origin: 'client',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'deliverable',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    due_authority_connection_id: null,
    short_id: 473,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00',
    ...overrides,
  }
}

describe('buildChildTaskInput — 子タスクの作り方', () => {
  it('親の子として作る（parentTaskId に親のid）', () => {
    const input = buildChildTaskInput(makeTask(), { title: '確認依頼: 粗利の下限を粗利率40%にする' })

    expect(input.parentTaskId).toBe('parent-1')
    expect(input.title).toBe('確認依頼: 粗利の下限を粗利率40%にする')
    expect(input.type).toBe('task')
  })

  it('担当は親の担当者を引き継ぐ（承認者を担当にしないため）', () => {
    const input = buildChildTaskInput(makeTask({ assignee_id: 'user-miyata' }), { title: '確認依頼: A' })

    expect(input.assigneeId).toBe('user-miyata')
  })

  it('親に担当者がいなければ、担当は未設定のままにする', () => {
    const input = buildChildTaskInput(makeTask({ assignee_id: null }), { title: '確認依頼: A' })

    expect(input.assigneeId).toBeUndefined()
  })

  it('ボールは社内・相手先には出さない（親が外部向けでも引き継がない）', () => {
    const input = buildChildTaskInput(makeTask({ ball: 'client', client_scope: 'deliverable' }), {
      title: '確認依頼: A',
    })

    expect(input.ball).toBe('internal')
    expect(input.origin).toBe('internal')
    expect(input.clientScope).toBe('internal')
    expect(input.clientOwnerIds).toEqual([])
    expect(input.internalOwnerIds).toEqual([])
  })

  it('説明を渡したときだけ説明を入れる', () => {
    expect(buildChildTaskInput(makeTask(), { title: 'A' }).description).toBeUndefined()
    expect(
      buildChildTaskInput(makeTask(), { title: 'A', description: '[なぜ] 理由' }).description
    ).toBe('[なぜ] 理由')
  })

  it('前後の空白は落とす', () => {
    const input = buildChildTaskInput(makeTask(), { title: '  確認依頼: A  ', description: '  本文  ' })

    expect(input.title).toBe('確認依頼: A')
    expect(input.description).toBe('本文')
  })
})

describe('確認依頼の書き出し', () => {
  it('題名は「確認依頼: 」で始める', () => {
    expect(REVIEW_REQUEST_TITLE_PREFIX).toBe('確認依頼: ')
  })

  it('説明欄のひな形は [なぜ] [影響] [根拠] [様子見] の4行', () => {
    const lines = REVIEW_REQUEST_DESCRIPTION_TEMPLATE.split('\n')

    expect(lines).toHaveLength(4)
    expect(lines[0].startsWith('[なぜ]')).toBe(true)
    expect(lines[1].startsWith('[影響]')).toBe(true)
    expect(lines[2].startsWith('[根拠]')).toBe(true)
    expect(lines[3].startsWith('[様子見]')).toBe(true)
  })
})

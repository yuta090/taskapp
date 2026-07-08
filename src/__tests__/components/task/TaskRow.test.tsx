import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task } from '@/types/database'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'サンプルタスク',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Task
}

describe('TaskRow — 用語統一 (M-1, M-3)', () => {
  it('ball=client のとき「クライアント確認待ち」バッジを表示する', () => {
    render(<TaskRow task={makeTask({ ball: 'client' })} />)
    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.queryByText('外部確認待ち')).not.toBeInTheDocument()
  })

  it('ステータスドロップダウンの選択肢が「着手予定」「社内承認中」を使う', () => {
    render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /ステータスを変更/ }))
    expect(screen.getByText('着手予定')).toBeInTheDocument()
    expect(screen.getByText('社内承認中')).toBeInTheDocument()
    expect(screen.queryByText('ToDo')).not.toBeInTheDocument()
    expect(screen.queryByText('Todo')).not.toBeInTheDocument()
    expect(screen.queryByText('承認確認中')).not.toBeInTheDocument()
  })

  it('ステータスを変更（現在: 〜）の aria-label が新ラベルを使う', () => {
    render(<TaskRow task={makeTask({ status: 'in_review' })} onStatusChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'ステータスを変更（現在: 社内承認中）' })).toBeInTheDocument()
  })

  it('reviewStatus バッジが社内承認の用語を使う', () => {
    const { rerender } = render(<TaskRow task={makeTask()} reviewStatus="open" />)
    expect(screen.getByText('社内承認待ち')).toBeInTheDocument()

    rerender(<TaskRow task={makeTask()} reviewStatus="approved" />)
    expect(screen.getByText('社内承認済み')).toBeInTheDocument()
  })

  it('in_review タスクのクイックアクションが「社内承認を依頼」を使う', () => {
    render(<TaskRow task={makeTask({ status: 'in_review' })} onClick={vi.fn()} />)
    expect(screen.getByText('社内承認を依頼')).toBeInTheDocument()
  })

  it('reviewStatus=changes_requested のバッジは「差し戻し」を使う（A6）', () => {
    render(<TaskRow task={makeTask()} reviewStatus="changes_requested" />)
    expect(screen.getByText('差し戻し')).toBeInTheDocument()
    expect(screen.queryByText('差戻')).not.toBeInTheDocument()
  })
})

describe('TaskRow — SPECバッジの説明ツールチップ (A5)', () => {
  it('type=spec のとき、SPECバッジにツールチップの説明文が付く', () => {
    render(<TaskRow task={makeTask({ type: 'spec' })} />)
    expect(screen.getByText('SPEC')).toBeInTheDocument()
    expect(screen.getByText('仕様タスク: 決定が必要な仕様に紐づくタスク')).toBeInTheDocument()
  })

  it('type=task のときはSPECバッジもツールチップも表示しない', () => {
    render(<TaskRow task={makeTask({ type: 'task' })} />)
    expect(screen.queryByText('SPEC')).not.toBeInTheDocument()
    expect(screen.queryByText('仕様タスク: 決定が必要な仕様に紐づくタスク')).not.toBeInTheDocument()
  })
})

describe('TaskRow — 取消済みレビュー (cancelled)', () => {
  it('reviewStatus=cancelled はレビュー無しと同様にバッジを表示しない', () => {
    render(<TaskRow task={makeTask()} reviewStatus="cancelled" />)
    expect(screen.queryByText('社内承認待ち')).not.toBeInTheDocument()
    expect(screen.queryByText('社内承認済み')).not.toBeInTheDocument()
    expect(screen.queryByText('差し戻し')).not.toBeInTheDocument()
  })

  it('in_review かつ reviewStatus=cancelled なら「社内承認を依頼」クイックアクションを出す', () => {
    render(
      <TaskRow task={makeTask({ status: 'in_review' })} reviewStatus="cancelled" onClick={vi.fn()} />
    )
    expect(screen.getByText('社内承認を依頼')).toBeInTheDocument()
  })
})

describe('TaskRow — 完了タスクの確認待ちバッジ除外 (A1)', () => {
  it('status=done かつ ball=client のときは「クライアント確認待ち」バッジを表示しない', () => {
    render(<TaskRow task={makeTask({ ball: 'client', status: 'done' })} />)
    expect(screen.queryByText('クライアント確認待ち')).not.toBeInTheDocument()
  })

  it('status!=done かつ ball=client のときは引き続きバッジを表示する', () => {
    render(<TaskRow task={makeTask({ ball: 'client', status: 'in_progress' })} />)
    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
  })
})

describe('TaskRow — クライアント待ち日数バッジ (B-4)', () => {
  it('ball=client かつ経過3日未満のときは日数バッジを表示しない', () => {
    const now = new Date('2026-07-05T12:00:00+09:00')
    render(
      <TaskRow
        task={makeTask({ ball: 'client', updated_at: '2026-07-04T12:00:00+09:00' })}
        now={now}
      />
    )
    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.queryByText(/日待ち/)).not.toBeInTheDocument()
  })

  it('ball=client かつ経過3日以上で「N日待ち」を表示する', () => {
    const now = new Date('2026-07-05T12:00:00+09:00')
    render(
      <TaskRow
        task={makeTask({ ball: 'client', updated_at: '2026-07-02T12:00:00+09:00' })}
        now={now}
      />
    )
    expect(screen.getByText('3日待ち')).toBeInTheDocument()
  })

  it('7日以上経過したときは強調表示（text-red-500）になる', () => {
    const now = new Date('2026-07-09T12:00:00+09:00')
    render(
      <TaskRow
        task={makeTask({ ball: 'client', updated_at: '2026-07-02T12:00:00+09:00' })}
        now={now}
      />
    )
    const badge = screen.getByText('7日待ち')
    expect(badge.className).toContain('text-red-500')
  })

  it('ball=internal のときは日数バッジを表示しない', () => {
    const now = new Date('2026-07-20T12:00:00+09:00')
    render(
      <TaskRow
        task={makeTask({ ball: 'internal', updated_at: '2026-07-02T12:00:00+09:00' })}
        now={now}
      />
    )
    expect(screen.queryByText(/日待ち/)).not.toBeInTheDocument()
  })
})

describe('TaskRow — ボール/公開ツールチップ (初回UX改善 D)', () => {
  it('ball=client のとき、ボール表示にツールチップの説明文が付く', () => {
    render(<TaskRow task={makeTask({ ball: 'client' })} />)
    expect(screen.getByText('次にアクションする側。外部=クライアントの対応待ち')).toBeInTheDocument()
  })

  it('ball=client のとき、公開インジケーターにツールチップの説明文が付く', () => {
    render(<TaskRow task={makeTask({ ball: 'client' })} />)
    expect(screen.getByText('ONでクライアントのポータルに表示されます')).toBeInTheDocument()
  })

  it('ball=internal のときはボール系ツールチップを表示しない', () => {
    render(<TaskRow task={makeTask({ ball: 'internal' })} />)
    expect(screen.queryByText('次にアクションする側。外部=クライアントの対応待ち')).not.toBeInTheDocument()
    expect(screen.queryByText('ONでクライアントのポータルに表示されます')).not.toBeInTheDocument()
  })
})

describe('TaskRow — サンプルタスクバッジ', () => {
  it('is_sample=true のとき「サンプル」バッジをグレーで表示する', () => {
    render(<TaskRow task={makeTask({ is_sample: true })} />)
    const badge = screen.getByText('サンプル')
    expect(badge).toBeInTheDocument()
    expect(badge.className).not.toContain('amber')
    expect(badge.className).toContain('gray')
  })

  it('is_sample=false のときは「サンプル」バッジを表示しない', () => {
    render(<TaskRow task={makeTask({ is_sample: false })} />)
    expect(screen.queryByText('サンプル')).not.toBeInTheDocument()
  })
})

describe('TaskRow — hover アクション (M-6)', () => {
  it('一括選択チェックボックスは hover/focus 時のみ表示するクラスを持つ（非バルクモード）', () => {
    render(<TaskRow task={makeTask()} onCheckChange={vi.fn()} />)
    const checkbox = screen.getByRole('button', { name: '選択' })
    expect(checkbox.className).toContain('opacity-0')
    expect(checkbox.className).toContain('group-hover:opacity-100')
    expect(checkbox.className).toContain('focus-within:opacity-100')
  })

  it('クイック完了チェックボックスは hover/focus 時のみ表示するクラスを持つ', () => {
    render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    const quickDone = screen.getByRole('button', { name: '完了にする' })
    expect(quickDone.className).toContain('opacity-0')
    expect(quickDone.className).toContain('group-hover:opacity-100')
    expect(quickDone.className).toContain('focus-within:opacity-100')
  })
})

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import type { WikiReferencingTask } from '@/lib/wiki/referencingTasks'
import type { WikiPage } from '@/types/database'

// ページ情報パネル（スマホでは情報シート）の「このページを参照しているタスク」。
// 行は番号・題名・状態・担当者。押すとタスク一覧でそのタスクを開く。

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページA',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    is_folder: false,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

function refTask(overrides: Partial<WikiReferencingTask> = {}): WikiReferencingTask {
  return {
    id: 't1',
    org_id: 'org1',
    space_id: 'space1',
    short_id: 42,
    title: 'ログイン画面を作る',
    status: 'in_progress',
    assignee_id: 'user2',
    assigneeName: '佐藤',
    ...overrides,
  }
}

describe('WikiPageInspector 参照しているタスク', () => {
  it('番号・題名・状態・担当者を出し、押すとそのタスクを開くリンクになっている', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} referencingTasks={[refTask()]} />)

    const section = screen.getByTestId('wiki-referencing-tasks')
    expect(within(section).getByText('このページを参照しているタスク')).toBeInTheDocument()
    const link = within(section).getByRole('link', { name: /ログイン画面を作る/ })
    expect(link).toHaveAttribute('href', '/org1/project/space1?task=t1')
    expect(within(link).getByText('TP-42')).toBeInTheDocument()
    expect(within(link).getByText('進行中')).toBeInTheDocument()
    expect(within(link).getByText('佐藤')).toBeInTheDocument()
  })

  it('担当者がいないタスクは「担当なし」と出す', () => {
    render(
      <WikiPageInspector
        page={page()}
        onClose={vi.fn()}
        referencingTasks={[refTask({ assignee_id: null, assigneeName: null })]}
      />
    )
    expect(within(screen.getByTestId('wiki-referencing-tasks')).getByText('担当なし')).toBeInTheDocument()
  })

  it('0件なら「このページを参照しているタスクはありません」と出す', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} referencingTasks={[]} />)
    expect(screen.getByText('このページを参照しているタスクはありません')).toBeInTheDocument()
  })

  it('読み込み中は「0件」の文言を出さない（あとから行が出て文言が消えるちらつきを避ける）', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} referencingTasks={[]} referencingTasksLoading />)
    expect(screen.queryByText('このページを参照しているタスクはありません')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('wiki-referencing-tasks')).getByText('読み込み中...')).toBeInTheDocument()
  })

  it('読み込みに失敗したら「0件」と言わず、読み込めなかったと出す', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} referencingTasks={[]} referencingTasksError />)
    expect(screen.queryByText('このページを参照しているタスクはありません')).not.toBeInTheDocument()
    expect(screen.getByText('参照しているタスクを読み込めませんでした')).toBeInTheDocument()
  })

  it('渡されなければ欄ごと出さない（参照の一覧を持たない使い方もある）', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} />)
    expect(screen.queryByTestId('wiki-referencing-tasks')).not.toBeInTheDocument()
  })

  it('完了したタスクは題名に取り消し線を引く（タスクの子タスク一覧と同じ見せ方）', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} referencingTasks={[refTask({ status: 'done' })]} />)
    expect(screen.getByText('ログイン画面を作る')).toHaveClass('line-through')
  })
})

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import type { WikiPage, Milestone } from '@/types/database'

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
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    name: 'マイルストーン1',
    start_date: null,
    due_date: null,
    order_key: 0,
    completed_at: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

describe('WikiPageInspector 整理セクション', () => {
  it('「一覧の先頭に固定」トグルは pinned_at が無ければ OFF', () => {
    render(
      <WikiPageInspector page={page({ pinned_at: null })} onClose={vi.fn()} onUpdate={vi.fn()} allPages={[]} milestones={[]} />
    )
    expect(screen.getByLabelText('一覧の先頭に固定')).not.toBeChecked()
  })

  it('「一覧の先頭に固定」トグルは pinned_at があれば ON', () => {
    render(
      <WikiPageInspector
        page={page({ pinned_at: '2026-09-01T00:00:00+09:00' })}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        allPages={[]}
        milestones={[]}
      />
    )
    expect(screen.getByLabelText('一覧の先頭に固定')).toBeChecked()
  })

  it('トグルを ON にすると pinned_at 非 null で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <WikiPageInspector page={page({ pinned_at: null })} onClose={vi.fn()} onUpdate={onUpdate} allPages={[]} milestones={[]} />
    )
    fireEvent.click(screen.getByLabelText('一覧の先頭に固定'))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ pinned_at: expect.any(String) })))
  })

  it('トグルを OFF にすると pinned_at: null で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <WikiPageInspector
        page={page({ pinned_at: '2026-09-01T00:00:00+09:00' })}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        allPages={[]}
        milestones={[]}
      />
    )
    fireEvent.click(screen.getByLabelText('一覧の先頭に固定'))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ pinned_at: null }))
  })

  it('親ページのセレクトに自分自身と子孫は出ない', () => {
    const allPages = [
      page({ id: 'page-1', title: '自分' }),
      page({ id: 'child', title: '子', parent_page_id: 'page-1' }),
      page({ id: 'grandchild', title: '孫', parent_page_id: 'child' }),
      page({ id: 'other', title: '他のページ' }),
    ]
    render(
      <WikiPageInspector page={page({ id: 'page-1' })} onClose={vi.fn()} onUpdate={vi.fn()} allPages={allPages} milestones={[]} />
    )
    const select = screen.getByLabelText('親ページ') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map(o => o.textContent)
    expect(optionLabels).toEqual(['なし', '他のページ'])
  })

  it('親ページを選ぶと parent_page_id で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const allPages = [page({ id: 'page-1' }), page({ id: 'other', title: '他のページ' })]
    render(
      <WikiPageInspector page={page({ id: 'page-1' })} onClose={vi.fn()} onUpdate={onUpdate} allPages={allPages} milestones={[]} />
    )
    fireEvent.change(screen.getByLabelText('親ページ'), { target: { value: 'other' } })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ parent_page_id: 'other' }))
  })

  it('親ページを「なし」に戻すと parent_page_id: null で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const allPages = [page({ id: 'page-1', parent_page_id: 'other' }), page({ id: 'other', title: '他のページ' })]
    render(
      <WikiPageInspector
        page={page({ id: 'page-1', parent_page_id: 'other' })}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        allPages={allPages}
        milestones={[]}
      />
    )
    fireEvent.change(screen.getByLabelText('親ページ'), { target: { value: '' } })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ parent_page_id: null }))
  })

  it('マイルストーンのセレクトに一覧が出て、選ぶと milestone_id で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const milestones = [milestone({ id: 'm1', name: 'マイルストーンA' })]
    render(
      <WikiPageInspector page={page()} onClose={vi.fn()} onUpdate={onUpdate} allPages={[]} milestones={milestones} />
    )
    const select = screen.getByLabelText('マイルストーン') as HTMLSelectElement
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['なし', 'マイルストーンA'])
    fireEvent.change(select, { target: { value: 'm1' } })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ milestone_id: 'm1' }))
  })

  it('onUpdate が失敗したらエラーメッセージを一行表示する', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('wiki parent must be in the same space'))
    const allPages = [page({ id: 'page-1' }), page({ id: 'other', title: '他のページ' })]
    render(
      <WikiPageInspector page={page({ id: 'page-1' })} onClose={vi.fn()} onUpdate={onUpdate} allPages={allPages} milestones={[]} />
    )
    fireEvent.change(screen.getByLabelText('親ページ'), { target: { value: 'other' } })
    await waitFor(() => expect(screen.getByText('同じスペースのページだけ選べます')).toBeInTheDocument())
  })

  it('onUpdate / allPages / milestones を省略しても描画できる（後方互換）', () => {
    expect(() => render(<WikiPageInspector page={page()} onClose={vi.fn()} />)).not.toThrow()
  })
})

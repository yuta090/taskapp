import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import type { WikiPage } from '@/types/database'

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    org_id: 'org1',
    space_id: 'space1',
    title: '26 MTGの進め方（固定の型）',
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

function renderInspector(onDelete: () => Promise<void>) {
  return render(
    <WikiPageInspector
      page={page()}
      onClose={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={onDelete}
      allPages={[]}
      milestones={[]}
    />
  )
}

const trashButton = () => screen.getByRole('button', { name: 'ページを削除' })

describe('WikiPageInspector の削除', () => {
  it('ゴミ箱を押しただけでは削除せず、確認を出す', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderInspector(onDelete)

    fireEvent.click(trashButton())

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('確認にページのタイトルが出る', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderInspector(onDelete)

    fireEvent.click(trashButton())

    expect(screen.getByRole('alertdialog')).toHaveTextContent('26 MTGの進め方（固定の型）')
  })

  it('ゴミ箱を続けて2回押しても削除しない（前の2回クリック方式では消えていた）', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderInspector(onDelete)

    fireEvent.click(trashButton())
    fireEvent.click(trashButton())

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('キャンセルすると削除しない', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderInspector(onDelete)

    fireEvent.click(trashButton())
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('確認の「削除する」を押したときだけ削除する', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderInspector(onDelete)

    fireEvent.click(trashButton())
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
  })

  it('確認を開いたまま別のページに切り替わったら、確認を閉じて削除しない', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <WikiPageInspector
        page={page()}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        allPages={[]}
        milestones={[]}
      />
    )

    fireEvent.click(trashButton())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    // ブラウザの「戻る」などで、パネルが別のページに差し替わる
    rerender(
      <WikiPageInspector
        page={page({ id: 'page-2', title: '別のページ' })}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        allPages={[]}
        milestones={[]}
      />
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('閲覧だけの人（onDelete が無い）にはゴミ箱を出さない', () => {
    render(
      <WikiPageInspector page={page()} onClose={vi.fn()} onUpdate={undefined} allPages={[]} milestones={[]} />
    )

    expect(screen.queryByRole('button', { name: 'ページを削除' })).not.toBeInTheDocument()
  })
})

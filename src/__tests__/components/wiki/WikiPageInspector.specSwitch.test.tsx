import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import type { WikiPage } from '@/types/database'

// 「仕様書として扱う」スイッチ。タグ配列に '仕様書' が入っているかどうかを
// トグルで表す。以前は自由入力のタグ欄に手打ちする方式で分かりにくかった。

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

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

describe('WikiPageInspector 仕様書スイッチ', () => {
  it('タグに仕様書が無ければスイッチは OFF', () => {
    render(<WikiPageInspector page={page({ tags: ['議事録'] })} onClose={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('wiki-spec-switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('タグに仕様書があればスイッチは ON', () => {
    render(<WikiPageInspector page={page({ tags: ['議事録', '仕様書'] })} onClose={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('wiki-spec-switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('スイッチを ON にすると、他のタグを残したまま仕様書が足された tags で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<WikiPageInspector page={page({ tags: ['議事録'] })} onClose={vi.fn()} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByTestId('wiki-spec-switch'))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ tags: ['議事録', '仕様書'] }))
  })

  it('スイッチを OFF にすると、仕様書だけが取り除かれた tags で onUpdate が呼ばれる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <WikiPageInspector page={page({ tags: ['議事録', '仕様書', '重要'] })} onClose={vi.fn()} onUpdate={onUpdate} />
    )
    fireEvent.click(screen.getByTestId('wiki-spec-switch'))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ tags: ['議事録', '重要'] }))
  })

  it('onUpdate が失敗したら toast.error で知らせる', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('network'))
    render(<WikiPageInspector page={page({ tags: [] })} onClose={vi.fn()} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByTestId('wiki-spec-switch'))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
  })

  it('仕様書チップはタグ一覧に出さない（スイッチが表している）', () => {
    render(<WikiPageInspector page={page({ tags: ['議事録', '仕様書'] })} onClose={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.queryByText('仕様書', { selector: 'span.bg-gray-100' })).not.toBeInTheDocument()
    // 議事録タグは通常どおりチップに出る
    expect(screen.getByText('議事録')).toBeInTheDocument()
  })

  it('スイッチの下に説明文が出る', () => {
    render(<WikiPageInspector page={page({ tags: [] })} onClose={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByText('タスクに紐づけると「検討中→決定」で管理します')).toBeInTheDocument()
  })

  it('読み取り専用（onUpdate 無し）ではスイッチを出さない', () => {
    render(<WikiPageInspector page={page({ tags: ['仕様書'] })} onClose={vi.fn()} />)
    expect(screen.queryByTestId('wiki-spec-switch')).not.toBeInTheDocument()
  })

  it('読み取り専用でも仕様書ページなら「仕様書」バッジを出す', () => {
    render(<WikiPageInspector page={page({ tags: ['仕様書'] })} onClose={vi.fn()} />)
    expect(screen.getByTestId('wiki-spec-badge')).toBeInTheDocument()
  })

  it('読み取り専用で仕様書でなければバッジは出さない', () => {
    render(<WikiPageInspector page={page({ tags: ['議事録'] })} onClose={vi.fn()} />)
    expect(screen.queryByTestId('wiki-spec-badge')).not.toBeInTheDocument()
  })
})

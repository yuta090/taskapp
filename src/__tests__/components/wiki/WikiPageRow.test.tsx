import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WikiPageRow, type WikiRowMember } from '@/components/wiki/WikiPageRow'
import type { Milestone, WikiPage } from '@/types/database'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} alt={(props.alt as string) ?? ''} />,
}))

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページタイトル',
    body: '',
    tags: ['要件', '設計'],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'user1',
    updated_by: 'user2',
    created_at: '2026-09-01T10:30:00+09:00',
    updated_at: '2026-09-05T00:00:00+09:00',
    ...overrides,
  }
}

const MEMBERS: Record<string, WikiRowMember> = {
  user1: { name: '田中太郎', avatarUrl: null },
  user2: { name: '鈴木花子', avatarUrl: 'https://example.com/a.png' },
}
const getMember = vi.fn((userId: string) => MEMBERS[userId] ?? null)

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    name: 'フェーズ1',
    start_date: null,
    due_date: null,
    order_key: 0,
    completed_at: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

describe('WikiPageRow', () => {
  it('columns=[] だとタイトルだけでメタ情報は出ない', () => {
    render(<WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} />)
    expect(screen.getByText('ページタイトル')).toBeInTheDocument()
    expect(screen.queryByText('要件')).not.toBeInTheDocument()
    expect(screen.queryByText('田中太郎')).not.toBeInTheDocument()
  })

  it('tags 列でタグチップが出る（最大3個＋残数）', () => {
    render(
      <WikiPageRow
        page={page({ tags: ['a', 'b', 'c', 'd'] })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['tags']}
        getMember={getMember}
      />
    )
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('c')).toBeInTheDocument()
    expect(screen.queryByText('d')).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('タグが無いページでは tags 列を出しても何も表示しない', () => {
    render(
      <WikiPageRow page={page({ tags: [] })} isSelected={false} onSelect={vi.fn()} columns={['tags']} getMember={getMember} />
    )
    expect(screen.queryByText('要件')).not.toBeInTheDocument()
  })

  it('author 列で作成者名が出る', () => {
    render(<WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={['author']} getMember={getMember} />)
    expect(screen.getByText('田中太郎')).toBeInTheDocument()
  })

  it('author のアバターは avatarUrl があれば画像で出る', () => {
    const { container } = render(
      <WikiPageRow
        page={page({ created_by: 'user2' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['author']}
        getMember={getMember}
      />
    )
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.png')
  })

  it('author のアバターは avatarUrl が無ければ頭文字で出る', () => {
    const { container } = render(
      <WikiPageRow
        page={page({ created_by: 'user1' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['author']}
        getMember={getMember}
      />
    )
    expect(screen.getByText('田')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('getMember が null を返すユーザーは UUID を出さず「?」アバターだけ表示する', () => {
    render(
      <WikiPageRow
        page={page({ created_by: 'unknown-user-id' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['author']}
        getMember={() => null}
      />
    )
    expect(screen.queryByText(/unknown-/)).not.toBeInTheDocument()
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('クリックすると onSelect にページ id が渡る', () => {
    const onSelect = vi.fn()
    render(
      <WikiPageRow page={page({ id: 'page-xyz' })} isSelected={false} onSelect={onSelect} columns={[]} getMember={getMember} />
    )
    fireEvent.click(screen.getByText('ページタイトル'))
    expect(onSelect).toHaveBeenCalledWith('page-xyz')
  })

  it('updater 列は created_by と異なるときだけ「更新: 名前」と出る', () => {
    render(
      <WikiPageRow
        page={page({ created_by: 'user1', updated_by: 'user2' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['updater']}
        getMember={getMember}
      />
    )
    expect(screen.getByText('更新: 鈴木花子')).toBeInTheDocument()
  })

  it('updater 列は created_by と同じなら省略される', () => {
    render(
      <WikiPageRow
        page={page({ created_by: 'user1', updated_by: 'user1' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['updater']}
        getMember={getMember}
      />
    )
    expect(screen.queryByText(/更新:/)).not.toBeInTheDocument()
  })

  it('created_at 列は「作成 M/D」表示で、title 属性に絶対時刻を持つ', () => {
    render(
      <WikiPageRow
        page={page({ created_at: '2026-09-01T10:30:00+09:00' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['created_at']}
        getMember={getMember}
      />
    )
    const el = screen.getByText(/^作成 /)
    expect(el.textContent).toBe('作成 9/1')
    expect(el.getAttribute('title')).toMatch(/^2026\/9\/1 \d{2}:\d{2}$/)
  })

  it('updated_at 列は右端に相対時刻を表示し、title に絶対時刻を持つ', () => {
    render(<WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={['updated_at']} getMember={getMember} />)
    const el = screen.getByTitle(/^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/)
    expect(el).toBeInTheDocument()
  })

  it('columns に updated_at が無ければ右端の時刻は出ない', () => {
    render(<WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} />)
    expect(screen.queryByTitle(/^\d{4}\//)).not.toBeInTheDocument()
  })

  it('pinned_at があればタイトル左にピンアイコンが出る', () => {
    const { container } = render(
      <WikiPageRow
        page={page({ pinned_at: '2026-09-01T00:00:00+09:00' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
      />
    )
    expect(container.querySelector('[data-testid="wiki-pin-icon"]')).toBeInTheDocument()
  })

  it('pinned_at が無ければピンアイコンは出ない', () => {
    const { container } = render(
      <WikiPageRow page={page({ pinned_at: null })} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} />
    )
    expect(container.querySelector('[data-testid="wiki-pin-icon"]')).not.toBeInTheDocument()
  })

  it('depth に応じて左パディングが増える', () => {
    const { container: c0 } = render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} depth={0} />
    )
    const { container: c2 } = render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} depth={2} />
    )
    const row0 = c0.firstElementChild as HTMLElement
    const row2 = c2.firstElementChild as HTMLElement
    expect(row0.style.paddingLeft).toBe('16px')
    expect(row2.style.paddingLeft).toBe('56px')
  })

  it('hasChildren なら折りたたみトグルが出る。クリックで onToggleCollapse にページ id が渡り、行クリックは発火しない', () => {
    const onToggleCollapse = vi.fn()
    const onSelect = vi.fn()
    render(
      <WikiPageRow
        page={page({ id: 'parent' })}
        isSelected={false}
        onSelect={onSelect}
        columns={[]}
        getMember={getMember}
        hasChildren
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
      />
    )
    fireEvent.click(screen.getByLabelText('折りたたむ'))
    expect(onToggleCollapse).toHaveBeenCalledWith('parent')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('collapsed なら展開ボタンのラベルになる', () => {
    render(
      <WikiPageRow
        page={page()}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        hasChildren
        collapsed
        onToggleCollapse={vi.fn()}
      />
    )
    expect(screen.getByLabelText('展開')).toBeInTheDocument()
  })

  it('hasChildren が false ならトグルボタンは出ない', () => {
    render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} hasChildren={false} />
    )
    expect(screen.queryByLabelText('展開')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('折りたたむ')).not.toBeInTheDocument()
  })

  describe('milestones 列（PR4: 所属マイルストーンをタグのように見せる）', () => {
    it('milestones 列でチップが出る', () => {
      render(
        <WikiPageRow
          page={page()}
          isSelected={false}
          onSelect={vi.fn()}
          columns={['milestones']}
          getMember={getMember}
          milestones={[milestone({ id: 'm1', name: 'フェーズ1' })]}
        />
      )
      expect(screen.getByText('フェーズ1')).toBeInTheDocument()
    })

    it('2個超は +N で省略する', () => {
      render(
        <WikiPageRow
          page={page()}
          isSelected={false}
          onSelect={vi.fn()}
          columns={['milestones']}
          getMember={getMember}
          milestones={[
            milestone({ id: 'm1', name: 'フェーズ1' }),
            milestone({ id: 'm2', name: 'フェーズ2' }),
            milestone({ id: 'm3', name: 'フェーズ3' }),
          ]}
        />
      )
      expect(screen.getByText('フェーズ1')).toBeInTheDocument()
      expect(screen.getByText('フェーズ2')).toBeInTheDocument()
      expect(screen.queryByText('フェーズ3')).not.toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('所属マイルストーンが無ければ milestones 列を出しても何も表示しない', () => {
      render(
        <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={['milestones']} getMember={getMember} milestones={[]} />
      )
      expect(screen.queryByText('フェーズ1')).not.toBeInTheDocument()
    })

    it('columns に milestones が無ければチップは出ない', () => {
      render(
        <WikiPageRow
          page={page()}
          isSelected={false}
          onSelect={vi.fn()}
          columns={[]}
          getMember={getMember}
          milestones={[milestone({ id: 'm1', name: 'フェーズ1' })]}
        />
      )
      expect(screen.queryByText('フェーズ1')).not.toBeInTheDocument()
    })

    it('マイルストーン別表示（duplicatedInOtherGroups が渡される）ではチップを出さず「他 N 件のマイルストーンにも」を出す', () => {
      render(
        <WikiPageRow
          page={page()}
          isSelected={false}
          onSelect={vi.fn()}
          columns={['milestones']}
          getMember={getMember}
          milestones={[milestone({ id: 'm1', name: 'フェーズ1' })]}
          duplicatedInOtherGroups={2}
        />
      )
      expect(screen.queryByText('フェーズ1')).not.toBeInTheDocument()
      expect(screen.getByText('他 2 件のマイルストーンにも')).toBeInTheDocument()
    })

    it('マイルストーン別表示で他のグループに出ていなければ（0件）何も出さない', () => {
      render(
        <WikiPageRow
          page={page()}
          isSelected={false}
          onSelect={vi.fn()}
          columns={['milestones']}
          getMember={getMember}
          milestones={[milestone({ id: 'm1', name: 'フェーズ1' })]}
          duplicatedInOtherGroups={0}
        />
      )
      expect(screen.queryByText('フェーズ1')).not.toBeInTheDocument()
      expect(screen.queryByText(/他 \d+ 件のマイルストーンにも/)).not.toBeInTheDocument()
    })
  })
})

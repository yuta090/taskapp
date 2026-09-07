import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WikiPageRow, type WikiRowMember } from '@/components/wiki/WikiPageRow'
import type { WikiPage } from '@/types/database'

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

describe('WikiPageRow', () => {
  it('columns=[] だとタイトルだけでメタ情報は出ない', () => {
    render(<WikiPageRow page={page()} isSelected={false} onClick={vi.fn()} columns={[]} getMember={getMember} />)
    expect(screen.getByText('ページタイトル')).toBeInTheDocument()
    expect(screen.queryByText('要件')).not.toBeInTheDocument()
    expect(screen.queryByText('田中太郎')).not.toBeInTheDocument()
  })

  it('tags 列でタグチップが出る（最大3個＋残数）', () => {
    render(
      <WikiPageRow
        page={page({ tags: ['a', 'b', 'c', 'd'] })}
        isSelected={false}
        onClick={vi.fn()}
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
      <WikiPageRow page={page({ tags: [] })} isSelected={false} onClick={vi.fn()} columns={['tags']} getMember={getMember} />
    )
    expect(screen.queryByText('要件')).not.toBeInTheDocument()
  })

  it('author 列で作成者名が出る', () => {
    render(<WikiPageRow page={page()} isSelected={false} onClick={vi.fn()} columns={['author']} getMember={getMember} />)
    expect(screen.getByText('田中太郎')).toBeInTheDocument()
  })

  it('author のアバターは avatarUrl があれば画像で出る', () => {
    const { container } = render(
      <WikiPageRow
        page={page({ created_by: 'user2' })}
        isSelected={false}
        onClick={vi.fn()}
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
        onClick={vi.fn()}
        columns={['author']}
        getMember={getMember}
      />
    )
    expect(screen.getByText('田')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('getMember が null を返すユーザーは id の先頭で代替表示する', () => {
    render(
      <WikiPageRow
        page={page({ created_by: 'unknown-user-id' })}
        isSelected={false}
        onClick={vi.fn()}
        columns={['author']}
        getMember={() => null}
      />
    )
    expect(screen.getByText('unknown-...')).toBeInTheDocument()
  })

  it('updater 列は created_by と異なるときだけ「更新: 名前」と出る', () => {
    render(
      <WikiPageRow
        page={page({ created_by: 'user1', updated_by: 'user2' })}
        isSelected={false}
        onClick={vi.fn()}
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
        onClick={vi.fn()}
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
        onClick={vi.fn()}
        columns={['created_at']}
        getMember={getMember}
      />
    )
    const el = screen.getByText(/^作成 /)
    expect(el.textContent).toBe('作成 9/1')
    expect(el.getAttribute('title')).toMatch(/^2026\/9\/1 \d{2}:\d{2}$/)
  })

  it('updated_at 列は右端に相対時刻を表示し、title に絶対時刻を持つ', () => {
    render(<WikiPageRow page={page()} isSelected={false} onClick={vi.fn()} columns={['updated_at']} getMember={getMember} />)
    const el = screen.getByTitle(/^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/)
    expect(el).toBeInTheDocument()
  })

  it('columns に updated_at が無ければ右端の時刻は出ない', () => {
    render(<WikiPageRow page={page()} isSelected={false} onClick={vi.fn()} columns={[]} getMember={getMember} />)
    expect(screen.queryByTitle(/^\d{4}\//)).not.toBeInTheDocument()
  })

  it('クリックで onClick が呼ばれる', () => {
    const onClick = vi.fn()
    render(<WikiPageRow page={page()} isSelected={false} onClick={onClick} columns={[]} getMember={getMember} />)
    screen.getByText('ページタイトル').click()
    expect(onClick).toHaveBeenCalled()
  })
})

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
    is_folder: false,
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

// 「確定 2/5」の印。確定の単位はページではなく決定1件なので、そのページに紐づく
// 決定事項のタスクを数えて出す。タスクが無いページには出さない。
describe('WikiPageRow 確定の印', () => {
  const renderRow = (decisionCount?: { total: number; decided: number }) =>
    render(
      <WikiPageRow
        page={page()}
        isSelected={false}
        onSelect={vi.fn()}
        columns={['tags']}
        getMember={getMember}
        decisionCount={decisionCount}
      />
    )

  it('決定事項のタスクが無ければ印を出さない', () => {
    renderRow(undefined)
    expect(screen.queryByTestId('wiki-decision-chip')).toBeNull()
  })

  it('0件でも印を出さない', () => {
    renderRow({ total: 0, decided: 0 })
    expect(screen.queryByTestId('wiki-decision-chip')).toBeNull()
  })

  it('途中なら「確定 2/5」を出す', () => {
    renderRow({ total: 5, decided: 2 })
    expect(screen.getByTestId('wiki-decision-chip').textContent).toBe('確定 2/5')
  })

  it('全部そろったら塗りつぶす', () => {
    renderRow({ total: 3, decided: 3 })
    const chip = screen.getByTestId('wiki-decision-chip')
    expect(chip.textContent).toBe('確定 3/3')
    expect(chip.className).toContain('bg-indigo-600')
  })

  it('途中は枠だけにする（塗りつぶさない）', () => {
    renderRow({ total: 3, decided: 1 })
    const chip = screen.getByTestId('wiki-decision-chip')
    expect(chip.className).toContain('border-indigo-200')
    expect(chip.className).not.toContain('bg-indigo-600')
  })

  it('表示項目の設定に関わらず出す（確定の見分けは常に要る）', () => {
    render(
      <WikiPageRow
        page={page()}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        decisionCount={{ total: 2, decided: 1 }}
      />
    )
    expect(screen.getByTestId('wiki-decision-chip').textContent).toBe('確定 1/2')
  })
})

// PR5: フォルダのアイコン・名前変更・削除・ドラッグ移動
describe('WikiPageRow フォルダ操作（PR5）', () => {
  it('isFolder なら Folder アイコンが出る', () => {
    const { container } = render(
      <WikiPageRow page={page({ is_folder: true })} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} isFolder />
    )
    expect(container.querySelector('[data-testid="wiki-folder-icon"]')).toBeInTheDocument()
  })

  it('isFolder が false ならアイコンは出ない', () => {
    const { container } = render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} isFolder={false} />
    )
    expect(container.querySelector('[data-testid="wiki-folder-icon"]')).not.toBeInTheDocument()
  })

  it('展開中(hasChildren かつ collapsed=false)は FolderOpen になる', () => {
    render(
      <WikiPageRow
        page={page({ is_folder: true })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        isFolder
        hasChildren
        collapsed={false}
      />
    )
    expect(screen.getByTestId('wiki-folder-icon').dataset.open).toBe('true')
  })

  it('canEdit かつ onRename があればタイトルのダブルクリックで編集状態になり、Enterで確定する', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow
        page={page({ id: 'folder-1', title: '元の名前' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        canEdit
        onRename={onRename}
      />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    const input = screen.getByDisplayValue('元の名前')
    fireEvent.change(input, { target: { value: '新しい名前' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('folder-1', '新しい名前')
  })

  it('編集中に Escape で取り消す（onRename は呼ばれない）', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow
        page={page({ title: '元の名前' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        canEdit
        onRename={onRename}
      />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    const input = screen.getByDisplayValue('元の名前')
    fireEvent.change(input, { target: { value: '変更中' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('元の名前')).toBeInTheDocument()
  })

  it('編集中に外をクリック(blur)すると、その時点の名前で確定する（1回だけ）', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow
        page={page({ id: 'folder-1', title: '元の名前' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        canEdit
        onRename={onRename}
      />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    const input = screen.getByDisplayValue('元の名前')
    fireEvent.change(input, { target: { value: '外で確定' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('folder-1', '外で確定')
  })

  it('Enter で確定したあとに blur が来ても二重に確定しない', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow
        page={page({ id: 'folder-1', title: '元の名前' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        canEdit
        onRename={onRename}
      />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    const input = screen.getByDisplayValue('元の名前')
    fireEvent.change(input, { target: { value: '新しい名前' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('空のまま外をクリックすると取り消す', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow
        page={page({ title: '元の名前' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        canEdit
        onRename={onRename}
      />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    const input = screen.getByDisplayValue('元の名前')
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('元の名前')).toBeInTheDocument()
  })

  it('空の名前では確定しない', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow
        page={page({ title: '元の名前' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        canEdit
        onRename={onRename}
      />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    const input = screen.getByDisplayValue('元の名前')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
  })

  it('canEdit が無ければダブルクリックしても編集状態にならない', () => {
    const onRename = vi.fn()
    render(
      <WikiPageRow page={page({ title: '元の名前' })} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} onRename={onRename} />
    )
    fireEvent.doubleClick(screen.getByText('元の名前'))
    expect(screen.queryByDisplayValue('元の名前')).not.toBeInTheDocument()
  })

  it('isFolder かつ canEdit で「…」メニューが出て、削除で onRequestDeleteFolder が呼ばれる', () => {
    const onRequestDeleteFolder = vi.fn()
    render(
      <WikiPageRow
        page={page({ id: 'folder-1', is_folder: true })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        isFolder
        canEdit
        onRequestDeleteFolder={onRequestDeleteFolder}
      />
    )
    fireEvent.click(screen.getByLabelText('フォルダの操作'))
    fireEvent.click(screen.getByText('削除'))
    expect(onRequestDeleteFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'folder-1' }))
  })

  it('メニューを開いても行クリック(onSelect)は発火しない', () => {
    const onSelect = vi.fn()
    render(
      <WikiPageRow
        page={page({ is_folder: true })}
        isSelected={false}
        onSelect={onSelect}
        columns={[]}
        getMember={getMember}
        isFolder
        canEdit
        onRequestDeleteFolder={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('フォルダの操作'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('isDraggable なら draggable 属性が付き、ドラッグ操作でコールバックが呼ばれる', () => {
    const onDragStartPage = vi.fn()
    const onDropPage = vi.fn()
    const onDragOverPage = vi.fn()
    const { container } = render(
      <WikiPageRow
        page={page({ id: 'row-1' })}
        isSelected={false}
        onSelect={vi.fn()}
        columns={[]}
        getMember={getMember}
        isDraggable
        onDragStartPage={onDragStartPage}
        onDragOverPage={onDragOverPage}
        onDropPage={onDropPage}
      />
    )
    const row = container.firstElementChild as HTMLElement
    expect(row).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(row, { dataTransfer: { effectAllowed: '' } })
    expect(onDragStartPage).toHaveBeenCalledWith('row-1')
    fireEvent.dragOver(row)
    expect(onDragOverPage).toHaveBeenCalledWith('row-1')
    fireEvent.drop(row)
    expect(onDropPage).toHaveBeenCalledWith('row-1')
  })

  it('isDraggable が無ければ draggable 属性は付かない', () => {
    const { container } = render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} />
    )
    const row = container.firstElementChild as HTMLElement
    expect(row).not.toHaveAttribute('draggable')
  })

  it('dropHighlight="valid" だと落とせる見た目になる', () => {
    const { container } = render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} isDraggable dropHighlight="valid" />
    )
    expect((container.firstElementChild as HTMLElement).className).toContain('border-indigo-400')
  })

  it('dropHighlight="invalid" だと落とせない見た目になる', () => {
    const { container } = render(
      <WikiPageRow page={page()} isSelected={false} onSelect={vi.fn()} columns={[]} getMember={getMember} isDraggable dropHighlight="invalid" />
    )
    expect((container.firstElementChild as HTMLElement).className).toContain('cursor-not-allowed')
  })
})

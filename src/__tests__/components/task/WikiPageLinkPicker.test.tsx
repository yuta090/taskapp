import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { WikiPageLinkPicker } from '@/components/task/WikiPageLinkPicker'

// タスク詳細の「仕様書連携」欄。1つの入力欄で
//  - 打つと Wiki ページが絞り込まれる（タグの有無に関係なく全ページ）
//  - 見つからなければ、その名前で新しく作ってそのまま紐づけられる

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

type Page = { id: string; title: string; tags: string[] }

const PAGES: Page[] = [
  { id: 'p1', title: '契約書テンプレート', tags: ['仕様書'] },
  { id: 'p2', title: '01 事業計画', tags: [] },
  { id: 'p3', title: '9月 定例 議事録', tags: [] },
]

function setup(overrides: Partial<React.ComponentProps<typeof WikiPageLinkPicker>> = {}) {
  const onSelect = vi.fn().mockResolvedValue(undefined)
  const onCreate = vi.fn().mockResolvedValue({ id: 'new1', title: '新しい資料', tags: [] })
  render(
    <WikiPageLinkPicker
      pages={PAGES}
      value={null}
      onSelect={onSelect}
      onCreate={onCreate}
      testId="picker"
      {...overrides}
    />
  )
  return { onSelect, onCreate }
}

function input() {
  return screen.getByTestId('picker-input')
}

function type(value: string) {
  fireEvent.focus(input())
  fireEvent.change(input(), { target: { value } })
}

describe('WikiPageLinkPicker — 探す', () => {
  beforeEach(() => vi.clearAllMocks())

  it('紐付けがないときは検索欄が出て、押すと最近のページが候補に出る', () => {
    setup()
    expect(input()).toHaveAttribute('placeholder', 'Wikiページを検索、または新しい名前を入力')

    fireEvent.focus(input())
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('打つと候補が絞られ、仕様書タグのないページも出る', () => {
    setup()
    type('事業')

    expect(screen.getByRole('option', { name: /01 事業計画/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /契約書テンプレート/ })).not.toBeInTheDocument()
  })

  it('候補を押すと、そのページを紐づける', async () => {
    const { onSelect } = setup()
    type('議事録')
    fireEvent.click(screen.getByRole('option', { name: /9月 定例 議事録/ }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('p3', expect.objectContaining({ id: 'p3' })))
  })

  it('矢印キーで選び直して Enter で紐づける', async () => {
    const { onSelect } = setup()
    fireEvent.focus(input())
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('p2', expect.objectContaining({ id: 'p2' })))
  })

  it('Esc で候補を閉じる', () => {
    setup()
    fireEvent.focus(input())
    fireEvent.keyDown(input(), { key: 'Escape' })

    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('閉じているときは候補のページ名を画面に置かない（他の欄の同じ名前と二重に見つからないように）', () => {
    setup()
    expect(screen.queryByText('契約書テンプレート')).not.toBeInTheDocument()

    fireEvent.focus(input())
    expect(screen.getByText('契約書テンプレート')).toBeInTheDocument()
  })

  it('候補が多いときは、あふれた件数を知らせる', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, title: `議事録 ${i + 1}`, tags: [] }))
    setup({ pages: many })
    fireEvent.focus(input())

    expect(screen.getByText('ほか 4 件。言葉を足すと絞り込めます')).toBeInTheDocument()
  })
})

describe('WikiPageLinkPicker — その場で作る', () => {
  beforeEach(() => vi.clearAllMocks())

  it('同じ名前のページがなければ「新しく作って紐づける」が出て、押すと作ってから紐づける', async () => {
    const { onSelect, onCreate } = setup()
    type('新しい資料')

    const create = screen.getByTestId('picker-create')
    expect(create).toHaveTextContent('「新しい資料」を新しく作って紐づける')
    fireEvent.click(create)

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new1', expect.objectContaining({ id: 'new1' })))
    expect(onCreate).toHaveBeenCalledWith('新しい資料')
    expect(onCreate.mock.invocationCallOrder[0]).toBeLessThan(onSelect.mock.invocationCallOrder[0])
  })

  it('長い名前でも「新しく作って紐づける」を切らずに折り返す（スマホ幅で末尾が「紐づ…」と切れていた）', () => {
    setup()
    type('とても長い名前の打ち合わせメモ（2026年9月 第2週 定例）')

    const create = screen.getByTestId('picker-create')
    expect(create).toHaveTextContent('を新しく作って紐づける')
    expect(create.querySelector('.truncate')).toBeNull()
  })

  it('候補がないときは Enter でそのまま作れる', async () => {
    const { onCreate } = setup()
    type('新しい資料')
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('新しい資料'))
  })

  it('名前の前後の空白は取り除いて作る', async () => {
    const { onCreate } = setup()
    type('  新しい資料  ')
    fireEvent.click(screen.getByTestId('picker-create'))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('新しい資料'))
  })

  it('同じ名前のページがあれば「新しく作る」は出さない（全角・半角の違いも同じ名前とみなす）', () => {
    setup()
    type('01 事業計画')
    expect(screen.queryByTestId('picker-create')).not.toBeInTheDocument()

    fireEvent.change(input(), { target: { value: '０１ 事業計画' } })
    expect(screen.queryByTestId('picker-create')).not.toBeInTheDocument()
  })

  it('作れなかったら知らせて、紐づけはしない', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('権限がありません'))
    const { onSelect } = setup({ onCreate })
    type('新しい資料')
    fireEvent.click(screen.getByTestId('picker-create'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('作っている途中にもう一度押しても、二重には作らない', async () => {
    let resolveCreate: (page: Page) => void = () => {}
    const onCreate = vi.fn(
      () => new Promise<Page>((resolve) => { resolveCreate = resolve })
    )
    const { onSelect } = setup({ onCreate })
    type('新しい資料')
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(onCreate).toHaveBeenCalledTimes(1)
    resolveCreate({ id: 'new1', title: '新しい資料', tags: [] })
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new1', expect.objectContaining({ id: 'new1' })))
  })
})

describe('WikiPageLinkPicker — 紐づけ中', () => {
  beforeEach(() => vi.clearAllMocks())

  it('紐づけ中のページ名を出す（仕様書タグのないページでも）', () => {
    setup({ value: 'p2' })

    expect(screen.getByTestId('picker-current')).toHaveTextContent('01 事業計画')
    expect(screen.queryByTestId('picker-input')).not.toBeInTheDocument()
  })

  it('× で紐づけを外す', async () => {
    const { onSelect } = setup({ value: 'p2' })
    fireEvent.click(screen.getByTestId('picker-clear'))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })

  it('ページ名を押すと検索欄に切り替わり、別のページに付け替えられる', async () => {
    const { onSelect } = setup({ value: 'p2' })
    fireEvent.click(screen.getByTestId('picker-current'))
    fireEvent.change(input(), { target: { value: '契約' } })
    fireEvent.click(screen.getByRole('option', { name: /契約書テンプレート/ }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'p1' })))
  })

  it('一覧を読み込み中でページ名が分からないときは「読み込み中…」と出す', () => {
    setup({ value: 'unknown', loading: true })

    expect(screen.getByTestId('picker-current')).toHaveTextContent('読み込み中…')
  })
})

describe('WikiPageLinkPicker — うまくいかなかったとき', () => {
  beforeEach(() => vi.clearAllMocks())

  it('作れなかったら「作れませんでした」と出す', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('network'))
    setup({ onCreate })
    type('新しい資料')
    fireEvent.click(screen.getByTestId('picker-create'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Wikiページを作れませんでした'))
  })

  it('作れたのに紐づけの保存だけ失敗したら、ページはできていると分かるように出す', async () => {
    const onSelect = vi.fn().mockRejectedValue(new Error('network'))
    setup({ onSelect })
    type('新しい資料')
    fireEvent.click(screen.getByTestId('picker-create'))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('ページは作りましたが、紐づけを保存できませんでした')
    )
  })

  it('紐づけの保存に失敗したら、候補の一覧を閉じる（下の欄に重なったまま残さない）', async () => {
    const onSelect = vi.fn().mockRejectedValue(new Error('network'))
    setup({ onSelect })
    type('議事録')
    fireEvent.click(screen.getByRole('option', { name: /9月 定例 議事録/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('紐づけを保存できませんでした'))
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('一覧を読み込み中は「新しく作る」を出さない（同じ名前のページを二重に作らないため）', () => {
    setup({ pages: [], loading: true })
    type('議事録')

    expect(screen.queryByTestId('picker-create')).not.toBeInTheDocument()
    expect(screen.getByText('Wikiページの一覧を読み込み中…')).toBeInTheDocument()
  })

  it('一覧を読み込めなかったときも「新しく作る」を出さない', () => {
    setup({ pages: [], loadError: true })
    type('議事録')

    expect(screen.queryByTestId('picker-create')).not.toBeInTheDocument()
    expect(screen.getByText('Wikiページの一覧を読み込めませんでした')).toBeInTheDocument()
  })

  it('失敗して一覧が閉じたあとも、Enter でもう一度開いてやり直せる', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'new1', title: '新しい資料', tags: [] })
    const { onSelect } = setup({ onCreate })
    type('新しい資料')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Wikiページを作れませんでした'))
    expect(screen.queryByTestId('picker-create')).not.toBeInTheDocument()

    // 1回目の Enter で一覧を開き直し、2回目で作り直す
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('picker-create')).toBeInTheDocument()
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith('new1', expect.objectContaining({ id: 'new1' }))
    )
  })
})

describe('WikiPageLinkPicker — 仕様書バッジ', () => {
  beforeEach(() => vi.clearAllMocks())

  it('仕様書タグの付いたページだけ候補にバッジが出る', () => {
    setup()
    fireEvent.focus(input())

    expect(
      within(screen.getByRole('option', { name: /契約書テンプレート/ })).getByTestId('picker-spec-badge')
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('option', { name: /01 事業計画/ })).queryByTestId('picker-spec-badge')
    ).not.toBeInTheDocument()
  })

  it('紐づけ中のページが仕様書なら現在地の表示にもバッジが出る', () => {
    setup({ value: 'p1' })

    expect(within(screen.getByTestId('picker-current')).getByTestId('picker-spec-badge')).toBeInTheDocument()
  })

  it('紐づけ中のページが仕様書でなければバッジは出ない', () => {
    setup({ value: 'p2' })

    expect(within(screen.getByTestId('picker-current')).queryByTestId('picker-spec-badge')).not.toBeInTheDocument()
  })
})

describe('WikiPageLinkPicker — キーボード・読み上げ', () => {
  beforeEach(() => vi.clearAllMocks())

  // 親が紐づけ先を持っていて、選ぶと表示が切り替わる実際の使われ方を再現する
  function StatefulPicker({ initial }: { initial: string | null }) {
    const [value, setValue] = React.useState<string | null>(initial)
    return (
      <WikiPageLinkPicker
        pages={PAGES}
        value={value}
        onSelect={async (id) => setValue(id)}
        onCreate={async () => ({ id: 'new1', title: '新しい資料', tags: [] })}
        testId="picker"
      />
    )
  }

  it('Enter で紐づけたら、表示されたページ名にフォーカスが移る（操作位置が先頭に飛ばない）', async () => {
    render(<StatefulPicker initial={null} />)
    input().focus()
    fireEvent.change(input(), { target: { value: '議事録' } })
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('picker-current')).toHaveFocus())
  })

  it('保存を待つ間にほかの欄へ移ったら、保存が終わってもフォーカスを奪わない', async () => {
    let finishSave: () => void = () => {}
    function PickerWithOtherField() {
      const [value, setValue] = React.useState<string | null>(null)
      return (
        <>
          <input data-testid="other-field" />
          <WikiPageLinkPicker
            pages={PAGES}
            value={value}
            onSelect={(id) =>
              new Promise<void>((resolve) => {
                finishSave = () => {
                  setValue(id)
                  resolve()
                }
              })
            }
            onCreate={async () => ({ id: 'new1', title: '新しい資料', tags: [] })}
            testId="picker"
          />
        </>
      )
    }
    render(<PickerWithOtherField />)
    input().focus()
    fireEvent.change(input(), { target: { value: '議事録' } })
    fireEvent.keyDown(input(), { key: 'Enter' })

    // 保存を待っている間に、タスク名など別の欄で入力を始める
    screen.getByTestId('other-field').focus()
    await act(async () => {
      finishSave()
    })

    await waitFor(() => expect(screen.getByTestId('picker-current')).toBeInTheDocument())
    expect(screen.getByTestId('other-field')).toHaveFocus()
  })

  it('× で外したら、出てきた検索欄にフォーカスが移る。候補の一覧は勝手に開かない', async () => {
    render(<StatefulPicker initial="p2" />)
    fireEvent.click(screen.getByTestId('picker-clear'))

    await waitFor(() => expect(screen.getByTestId('picker-input')).toHaveFocus())
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('候補の一覧が閉じていても、入力欄が指す一覧の要素は存在する', () => {
    setup()
    const listId = input().getAttribute('aria-controls')

    expect(listId).toBeTruthy()
    expect(document.getElementById(listId!)).not.toBeNull()
  })
})

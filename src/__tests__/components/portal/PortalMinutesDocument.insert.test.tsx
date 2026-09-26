import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PortalMinutesDocument } from '@/components/portal/PortalMinutesDocument'
import { PortalInsertionContext, type PortalInsertionContextValue } from '@/components/portal/PortalInsertionContext'
import type { DocInsertion } from '@/lib/doc-insertions/logic'

const MINE = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const row = (id: string, over: Partial<DocInsertion> = {}): DocInsertion => ({
  id, org_id: 'o', space_id: 's', wiki_page_id: null, meeting_id: 'm', kind: 'paragraph', content: '足した行',
  anchor: null, status: 'pending', anchor_missed: false, author_id: 'me', author_name: '鈴木', created_at: '2026-09-26T05:30:00Z',
  ...over,
})

function renderWith(md: string, over: Partial<PortalInsertionContextValue> = {}) {
  const value: PortalInsertionContextValue = {
    rows: [],
    create: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  render(
    <PortalInsertionContext.Provider value={value}>
      <PortalMinutesDocument md={md} />
    </PortalInsertionContext.Provider>
  )
  return value
}

describe('ポータルの議事録に書き足す', () => {
  it('行ごとの「＋」から、その行の後ろに行・メモを書き足す（足す場所はその行の Markdown）', async () => {
    const value = renderWith('# 定例\n\n決めたこと\n\n- 案A\n- 案B')
    const plus = screen.getAllByRole('button', { name: 'この後ろに書き足す' })
    expect(plus).toHaveLength(3) // 見出し・段落・箇条書きのまとまり
    fireEvent.click(plus[1])
    const form = screen.getByRole('form', { name: '書き足す' })
    fireEvent.click(within(form).getByRole('radio', { name: 'メモ' }))
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: '予算が\n合わない' } })
    fireEvent.click(within(form).getByRole('button', { name: '送る' }))
    expect(value.create).toHaveBeenCalledWith('meeting_note', '予算が\n合わない', '決めたこと')
  })

  it('箇条書きのまとまりの後ろは、最後の項目を足す場所にする', () => {
    const value = renderWith('- 案A\n- 案B')
    fireEvent.click(screen.getByRole('button', { name: 'この後ろに書き足す' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '送る' }))
    expect(value.create).toHaveBeenCalledWith('paragraph', 'x', '- 案B')
  })

  it('末尾の「行・メモを足す」は、最後に足す（足す場所なし）', () => {
    const value = renderWith('# 定例')
    fireEvent.click(screen.getByRole('button', { name: '＋ 行・メモを足す' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '最後に' } })
    fireEvent.click(screen.getByRole('button', { name: '送る' }))
    expect(value.create).toHaveBeenCalledWith('paragraph', '最後に', null)
  })

  it('目印（<!-- -->）を含む本文は送らせない', () => {
    const value = renderWith('# 定例')
    fireEvent.click(screen.getByRole('button', { name: '＋ 行・メモを足す' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a<!--task:x-->' } })
    expect(screen.getByRole('button', { name: '送る' })).toBeDisabled()
    expect(value.create).not.toHaveBeenCalled()
  })

  it('自分の反映待ちは足す場所の後ろに「反映待ち」で出し、取り消せる。場所が無いものは末尾に出す', () => {
    const value = renderWith('# 定例\n\n決めたこと', {
      rows: [row('p1', { anchor: '決めたこと', content: '後ろに足した' }), row('p2', { anchor: '消えた行', content: '場所なし' })],
    })
    const pending = screen.getAllByTestId('doc-insertion')
    expect(pending.map((el) => el.textContent)).toEqual([
      expect.stringContaining('後ろに足した'),
      expect.stringContaining('場所なし'),
    ])
    expect(within(pending[0]).getByText('反映待ち')).toBeInTheDocument()
    fireEvent.click(within(pending[0]).getByRole('button', { name: '取り消す' }))
    expect(value.withdraw).toHaveBeenCalledWith('p1')
  })

  it('本文に入った自分の行には「削除」を出す。削除を頼んだあとは「削除待ち」', () => {
    const md = `<!--ins:${MINE} paragraph 2026-09-26T14:30 鈴木-->入った行`
    const value = renderWith(md, { rows: [row(MINE, { status: 'applied' })] })
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(value.withdraw).toHaveBeenCalledWith(MINE)
  })

  it('削除を頼んだ行は「削除待ち」', () => {
    const md = `<!--ins:${MINE} paragraph 2026-09-26T14:30 鈴木-->入った行`
    renderWith(md, { rows: [row(MINE, { status: 'remove_requested' })] })
    expect(screen.getByText('削除待ち')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).toBeNull()
  })

  it('書き足せない画面では「＋」を出さない。相手先が足した行は書いた人つきで出す', () => {
    render(<PortalMinutesDocument md={`<!--ins:${MINE} meeting_note 2026-09-26T14:30 鈴木 一郎-->メモ`} />)
    expect(screen.queryByRole('button', { name: 'この後ろに書き足す' })).toBeNull()
    expect(screen.getByText('鈴木 一郎')).toBeInTheDocument()
    expect(screen.getByTestId('doc-insertion')).toHaveAttribute('data-kind', 'meeting_note')
  })
})

describe('ポータルの書き足し（直し）', () => {
  it('反映済みの行は重ねて出さない（社内が本文から消した行が残り続けないように）', () => {
    renderWith('# 定例', { rows: [row('a1', { status: 'applied', content: '反映済みで本文に無い' })] })
    expect(screen.queryByText('反映済みで本文に無い')).toBeNull()
  })

  it('取り消しに失敗したら理由を出す', async () => {
    renderWith('# 定例', {
      rows: [row('p1', { content: '取り消す行' })],
      withdraw: vi.fn().mockRejectedValue({ code: '22023', message: 'invalid_state' }),
    })
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }))
    expect(await screen.findByText('この行はもう取り消せません')).toBeInTheDocument()
  })
})

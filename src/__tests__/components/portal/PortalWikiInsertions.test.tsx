import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PortalWikiInsertions } from '@/components/portal/PortalWikiInsertions'
import type { DocInsertion } from '@/lib/doc-insertions/logic'

const row = (id: string, over: Partial<DocInsertion> = {}): DocInsertion => ({
  id, org_id: 'o', space_id: 's', wiki_page_id: 'w1', meeting_id: null, kind: 'paragraph', content: '足した行',
  anchor: null, status: 'pending', anchor_missed: false, author_id: 'me', author_name: '鈴木', created_at: '2026-09-26T05:30:00Z',
  ...over,
})

function setup(rows: DocInsertion[] = []) {
  const create = vi.fn().mockResolvedValue(undefined)
  const withdraw = vi.fn().mockResolvedValue(undefined)
  render(<PortalWikiInsertions rows={rows} create={create} withdraw={withdraw} />)
  return { create, withdraw }
}

describe('ポータルの Wiki に書き足す', () => {
  it('ページの末尾に行・メモを書き足す', () => {
    const { create } = setup()
    fireEvent.click(screen.getByRole('button', { name: '＋ 行・メモを足す' }))
    const form = screen.getByRole('form', { name: '書き足す' })
    fireEvent.click(within(form).getByRole('radio', { name: 'メモ' }))
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: '確認しました' } })
    fireEvent.click(within(form).getByRole('button', { name: '送る' }))
    expect(create).toHaveBeenCalledWith('meeting_note', '確認しました', null)
  })

  it('自分の書き足しを状態ごとに出す。反映待ちは取り消せる', () => {
    const { withdraw } = setup([
      row('p1', { content: '待っている行' }),
      row('a1', { status: 'applied', content: '入った行' }),
      row('r1', { status: 'remove_requested', content: '消してもらう行' }),
    ])
    const list = screen.getByRole('list', { name: 'あなたの書き足し' })
    expect(within(list).getByText('待っている行')).toBeInTheDocument()
    expect(within(list).getByText('反映待ち')).toBeInTheDocument()
    // Wiki は公開した時点の控えを出しているので、反映済みでも次の公開まで本文には出ない
    expect(within(list).getByText('反映済み（次の公開で本文に出ます）')).toBeInTheDocument()
    expect(within(list).getByText('削除待ち')).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: '取り消す' }))
    expect(withdraw).toHaveBeenCalledWith('p1')
  })

  it('反映済みの行は削除を頼める。下に社内の行があって頼めないときは理由を出す', async () => {
    const withdraw = vi.fn().mockRejectedValue({ code: '22023', message: 'has_children' })
    render(<PortalWikiInsertions rows={[row('a1', { status: 'applied' })]} create={vi.fn()} withdraw={withdraw} />)
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(await screen.findByText('この行の下に社内の書き足しがあるため、削除できません')).toBeInTheDocument()
  })

  it('書き足しが無ければ一覧は出さない', () => {
    setup([])
    expect(screen.queryByRole('list', { name: 'あなたの書き足し' })).toBeNull()
  })
})

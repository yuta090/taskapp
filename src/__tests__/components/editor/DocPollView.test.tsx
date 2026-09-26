import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DocPollView } from '@/components/editor/docPoll/DocPollView'
import type { DocPollState, DocVote, DocVoteEvent } from '@/lib/doc-polls/types'

const names: Record<string, string> = { me: '高橋', a: '田中', b: '佐藤' }
const nameOf = (id: string) => names[id] ?? '不明'

const vote = (user_id: string, choice: DocVote['choice'], memo = '', t = '2026-09-26T01:00:00Z'): DocVote => ({
  poll_id: 'p1', user_id, choice, memo, created_at: t, updated_at: t,
})
const ev = (id: number, user_id: string, action: DocVoteEvent['action'], choice: DocVoteEvent['choice'], memo = ''): DocVoteEvent => ({
  id, poll_id: 'p1', user_id, action, choice, memo, created_at: '2026-09-26T01:0' + id + ':00Z',
})

function makeState(reason: 'none' | 'ng_hold', votes: DocVote[], events: DocVoteEvent[] = []): DocPollState {
  return {
    poll: {
      id: 'p1', org_id: 'o', space_id: 's', wiki_page_id: 'w', meeting_id: null,
      reason_required: reason, created_by: 'me', created_at: 't',
    },
    votes,
    events,
  }
}

function setup(props: Partial<React.ComponentProps<typeof DocPollView>> = {}) {
  const onCast = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <DocPollView
      reasonRequired="none"
      state={makeState('none', [])}
      status="ready"
      currentUserId="me"
      nameOf={nameOf}
      onCast={onCast}
      contentRef={() => {}}
      {...props}
    />
  )
  return { onCast, ...utils }
}

describe('DocPollView', () => {
  it('本文の中で目立つよう、色付きの面と左の帯、「投票」の札で出す', () => {
    setup()
    const block = screen.getByTestId('doc-poll')
    expect(block).toHaveClass('bg-indigo-50', 'border-l-4', 'border-l-indigo-500')
    expect(within(block).getByText('投票')).toBeInTheDocument()
  })

  it('OK / NG / 保留のボタンに人数を出し、自分の選んだものを押された状態にする', () => {
    setup({ state: makeState('none', [vote('me', 'ng'), vote('a', 'ok'), vote('b', 'ok')]) })
    expect(screen.getByRole('button', { name: /OK 2/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /NG 1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /保留 0/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('押すと、その選択で送る（メモは今のまま）', () => {
    const { onCast } = setup()
    fireEvent.click(screen.getByRole('button', { name: /OK/ }))
    expect(onCast).toHaveBeenCalledWith('ok', '')
  })

  it('選び直すときは今のメモを引き継ぐ', () => {
    const { onCast } = setup({ state: makeState('none', [vote('me', 'ok', '前のメモ')]) })
    fireEvent.click(screen.getByRole('button', { name: /保留/ }))
    expect(onCast).toHaveBeenCalledWith('hold', '前のメモ')
  })

  it('自分が選んでいるボタンをもう一度押すと取り消す', () => {
    const { onCast } = setup({ state: makeState('none', [vote('me', 'ok')]) })
    fireEvent.click(screen.getByRole('button', { name: /OK 1/ }))
    expect(onCast).toHaveBeenCalledWith(null, '')
  })

  it('理由必須の投票では印を出し、NG を押すとすぐ送らず理由の欄を開く', async () => {
    const { onCast } = setup({ reasonRequired: 'ng_hold', state: makeState('ng_hold', []) })
    expect(screen.getByText('NG・保留は理由必須')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /NG/ }))
    expect(onCast).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: 'NG の理由' })
    const send = within(dialog).getByRole('button', { name: 'NG で送る' })
    expect(send).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '予算が\n合わない' } })
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(onCast).toHaveBeenCalledWith('ng', '予算が\n合わない')
  })

  it('理由任意でも、あとからメモを書ける', async () => {
    const { onCast } = setup({ state: makeState('none', [vote('me', 'ok')]) })
    fireEvent.click(screen.getByRole('button', { name: 'メモを書く' }))
    const dialog = await screen.findByRole('dialog', { name: 'OK のメモ' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '金曜まで' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK で送る' }))
    expect(onCast).toHaveBeenCalledWith('ok', '金曜まで')
  })

  it('Esc で理由の欄を閉じ、送らない', async () => {
    const { onCast } = setup({ reasonRequired: 'ng_hold', state: makeState('ng_hold', []) })
    fireEvent.click(screen.getByRole('button', { name: /保留/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onCast).not.toHaveBeenCalled()
  })

  it('押した人の名前とメモ（改行のまま）を、選んだボタンごとに並べる', () => {
    setup({ state: makeState('none', [vote('a', 'ok'), vote('b', 'hold', '来週まで\n待って')]) })
    const hold = screen.getByTestId('doc-poll-group-hold')
    expect(within(hold).getByText('佐藤')).toBeInTheDocument()
    expect(within(hold).getByText((_, el) => el?.textContent === '来週まで\n待って')).toBeInTheDocument()
    expect(within(screen.getByTestId('doc-poll-group-ok')).getByText('田中')).toBeInTheDocument()
    expect(screen.queryByTestId('doc-poll-group-ng')).toBeNull()
  })

  it('選び直した人には「変更あり」を出し、押すと経緯を出す', () => {
    setup({
      state: makeState(
        'none',
        [vote('a', 'hold', '理由')],
        [ev(1, 'a', 'cast', 'ok'), ev(2, 'a', 'change', 'hold', '理由'), ev(3, 'b', 'cast', 'ok')]
      ),
    })
    const toggle = screen.getByRole('button', { name: '変更あり' })
    fireEvent.click(toggle)
    const history = screen.getByTestId('doc-poll-history-a')
    expect(within(history).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('OK'),
      expect.stringMatching(/保留.*理由/),
    ])
  })

  it('送れなかったら理由を出す', async () => {
    const onCast = vi.fn().mockRejectedValue({ code: '42501', message: 'forbidden' })
    setup({ onCast })
    fireEvent.click(screen.getByRole('button', { name: /OK/ }))
    expect(await screen.findByText('この投票には押せません')).toBeInTheDocument()
  })

  it('この画面で投票できないときは、ボタンを押せなくして理由を出す', () => {
    setup({ status: 'unavailable', state: undefined })
    expect(screen.getByRole('button', { name: /OK/ })).toBeDisabled()
    expect(screen.getByText('この画面では投票できません')).toBeInTheDocument()
  })

  it('ログインしている人が分からないときも押せない', () => {
    setup({ currentUserId: null })
    expect(screen.getByRole('button', { name: /OK/ })).toBeDisabled()
  })
})

describe('DocPollView の議題を外から渡す（ポータルの議事録のように本文を自前で描く画面）', () => {
  it('title を渡すと、その中身を議題として出す', () => {
    setup({ title: <span>会場はオンラインでよいか</span>, contentRef: undefined })
    expect(screen.getByText('会場はオンラインでよいか')).toBeInTheDocument()
  })
})

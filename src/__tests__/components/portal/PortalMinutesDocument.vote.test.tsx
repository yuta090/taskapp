import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PortalMinutesDocument } from '@/components/portal/PortalMinutesDocument'
import { DocPollContext, type DocPollContextValue } from '@/components/editor/docPoll/docPollBlock'

const ID = '0b6f0c1e-7a3d-4c1b-9e2a-1f2e3d4c5b6a'

function ctx(over: Partial<DocPollContextValue> = {}): DocPollContextValue {
  return {
    polls: {
      [ID]: {
        poll: { id: ID, org_id: 'o', space_id: 's', wiki_page_id: null, meeting_id: 'm', reason_required: 'none', created_by: null, created_at: 't' },
        votes: [{ poll_id: ID, user_id: 'u1', choice: 'ok', memo: '', created_at: '2026-09-26T01:00:00Z', updated_at: '2026-09-26T01:00:00Z' }],
        events: [],
      },
    },
    isFetched: true,
    currentUserId: 'me',
    nameOf: () => '田中',
    castVote: vi.fn().mockResolvedValue(undefined),
    canCreate: false,
    failedIds: new Set(),
    ...over,
  }
}

describe('ポータルの議事録の投票', () => {
  it('投票の行を、議題とボタン・押した人つきで出し、押せる', () => {
    const value = ctx()
    render(
      <DocPollContext.Provider value={value}>
        <PortalMinutesDocument md={`前の段落\n\n<!--vote:${ID}-->会場はオンラインでよいか`} />
      </DocPollContext.Provider>
    )
    expect(screen.getByText('会場はオンラインでよいか')).toBeInTheDocument()
    expect(screen.getByText('田中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /NG/ }))
    expect(value.castVote).toHaveBeenCalledWith({ pollId: ID, userId: 'me', choice: 'ng', memo: '' })
  })

  it('投票を配らない画面では、議題と「この画面では投票できません」を出す（文字を落とさない）', () => {
    render(<PortalMinutesDocument md={`<!--vote:${ID}-->会場はオンラインでよいか`} />)
    expect(screen.getByText('会場はオンラインでよいか')).toBeInTheDocument()
    expect(screen.getByText('この画面では投票できません')).toBeInTheDocument()
  })
})

describe('ポータルの投票が見えないとき', () => {
  it('配られた closedNote で「終了しました」と出す', () => {
    render(
      <DocPollContext.Provider value={ctx({ polls: {}, closedNote: 'この投票は終了しました' })}>
        <PortalMinutesDocument md={`<!--vote:${ID}-->会場はオンラインでよいか`} />
      </DocPollContext.Provider>
    )
    expect(screen.getByText('この投票は終了しました')).toBeInTheDocument()
  })
})

import { hasDocPollInMinutes, hasDocPollInWikiBody } from '@/lib/doc-polls/logic'

describe('投票があるかの目安（無ければ読み込みも合図も張らない）', () => {
  it('議事録は <!--vote: の行があるか', () => {
    expect(hasDocPollInMinutes(`前\n<!--vote:${ID}-->議題`)).toBe(true)
    expect(hasDocPollInMinutes('# 投票はしない\n- 本文')).toBe(false)
    expect(hasDocPollInMinutes(null)).toBe(false)
  })
  it('Wiki は docPoll のブロックがあるか', () => {
    expect(hasDocPollInWikiBody('[{"type":"docPoll","props":{}}]')).toBe(true)
    expect(hasDocPollInWikiBody('[{"type":"paragraph"}]')).toBe(false)
    expect(hasDocPollInWikiBody(undefined)).toBe(false)
  })
})

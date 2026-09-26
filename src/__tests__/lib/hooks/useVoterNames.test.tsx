import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocPollState } from '@/lib/doc-polls/types'

const inIds = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({
        in: async (col: string, ids: string[]) => {
          inIds(table, cols, col, ids)
          return { data: [{ id: 'u1', display_name: '田中' }], error: null }
        },
      }),
    }),
  }),
}))

import { useVoterNames } from '@/lib/hooks/useVoterNames'

const polls = (): Record<string, DocPollState> => ({
  p1: {
    poll: { id: 'p1', org_id: 'o', space_id: 's', wiki_page_id: null, meeting_id: 'm', reason_required: 'none', created_by: null, created_at: 't' },
    votes: [{ poll_id: 'p1', user_id: 'u2', choice: 'ok', memo: '', created_at: 't', updated_at: 't' }],
    events: [
      { id: 1, poll_id: 'p1', user_id: 'u1', action: 'cast', choice: 'ok', memo: '', created_at: 't' },
      { id: 2, poll_id: 'p1', user_id: 'u1', action: 'retract', choice: null, memo: '', created_at: 't' },
    ],
  },
})

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => inIds.mockReset())

describe('useVoterNames（ポータルで押した人の名前を引く）', () => {
  it('票と履歴に出てくる人の名前を、表示名の列だけまとめて1回で読む（メールは読まない）', async () => {
    const { result } = renderHook(() => useVoterNames(polls()), { wrapper: wrapper() })
    await waitFor(() => expect(result.current('u1')).toBe('田中'))
    expect(inIds).toHaveBeenCalledTimes(1)
    expect(inIds).toHaveBeenCalledWith('profiles', 'id, display_name', 'id', ['u1', 'u2'])
  })

  it('読めない人（見える範囲の外）は言葉で出す', async () => {
    const { result } = renderHook(() => useVoterNames(polls()), { wrapper: wrapper() })
    await waitFor(() => expect(result.current('u1')).toBe('田中'))
    expect(result.current('u2')).toBe('（メンバー外の人）')
  })

  it('渡されなければ読まない', () => {
    renderHook(() => useVoterNames(null), { wrapper: wrapper() })
    expect(inIds).not.toHaveBeenCalled()
  })
})

describe('useVoterNames の読み込み中', () => {
  it('まだ届いていない間は空で出す（「メンバー外」とちらつかせない）', () => {
    const { result } = renderHook(() => useVoterNames(polls()), { wrapper: wrapper() })
    expect(result.current('u1')).toBe('')
  })
})

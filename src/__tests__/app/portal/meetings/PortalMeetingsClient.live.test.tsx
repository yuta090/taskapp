import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// 相手先ポータルの議事録を、社内が保存したらその場で読み直す（DOC_VOTE_SPEC §6・PR4）。
// 合図（minutes-saved）は本文を運ばないので、受けた画面が RLS 越しに読み直す。

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/portal/meetings',
}))
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'cli' }, loading: false, error: null }),
}))
vi.mock('@/components/editor/docPoll/DocPollHost', () => ({
  DocPollHost: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const listeners = new Map<string, () => void>()
const offs: string[] = []
vi.mock('@/lib/hooks/useDocVoteSignal', () => ({
  onDocSignal: (topic: string, event: string, cb: () => void) => {
    listeners.set(`${topic}|${event}`, cb)
    return () => offs.push(`${topic}|${event}`)
  },
}))

const fetched = vi.fn()
let serverMd = '# 最新\n\n- 社内が足した行\n'
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            fetched(table, cols, col, val)
            return { data: { minutes_md: serverMd }, error: null }
          },
        }),
      }),
    }),
  }),
}))

import { PortalMeetingsClient } from '@/app/portal/meetings/PortalMeetingsClient'

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }
const MEETING = {
  id: 'm1',
  title: '定例会議',
  heldAt: '2026-09-26T10:00:00+09:00',
  status: 'in_progress',
  minutesMd: '# はじめ\n',
  summarySubject: null,
  summaryBody: null,
  startedAt: '2026-09-26T10:00:00+09:00',
  endedAt: null,
}

function renderAndOpen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PortalMeetingsClient currentProject={project} projects={[project]} meetings={[MEETING]} />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /定例会議/ }))
  return utils
}

beforeEach(() => {
  listeners.clear()
  offs.length = 0
  fetched.mockReset()
  serverMd = '# 最新\n\n- 社内が足した行\n'
})

describe('ポータルの議事録をその場で読み直す', () => {
  it('開いている会議の「保存された」知らせを受けたら、本文を読み直して出す', async () => {
    renderAndOpen()
    expect(screen.getByText('はじめ')).toBeInTheDocument()
    const cb = listeners.get('meeting-minutes-view:m1|minutes-saved')
    expect(cb).toBeTruthy()
    await act(async () => {
      cb!()
    })
    await waitFor(() => expect(screen.getByText('社内が足した行')).toBeInTheDocument())
    // 読むのは本文の列だけ（ほかの列は要らない）
    expect(fetched).toHaveBeenCalledWith('meetings', 'minutes_md', 'id', 'm1')
  })

  it('知らせが続けて届いても、読み直しは1回にまとめる', async () => {
    renderAndOpen()
    const cb = listeners.get('meeting-minutes-view:m1|minutes-saved')!
    await act(async () => {
      cb()
      cb()
      cb()
    })
    await waitFor(() => expect(screen.getByText('社内が足した行')).toBeInTheDocument())
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  it('議事録がまだ空の会議でも待つ（会議中に書き始めたら出る）', async () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <PortalMeetingsClient currentProject={project} projects={[project]} meetings={[{ ...MEETING, minutesMd: null }]} />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /定例会議/ }))
    await act(async () => {
      listeners.get('meeting-minutes-view:m1|minutes-saved')!()
    })
    await waitFor(() => expect(screen.getByText('社内が足した行')).toBeInTheDocument())
  })

  it('閉じたら待つのをやめる', () => {
    const { unmount } = renderAndOpen()
    unmount()
    expect(offs).toContain('meeting-minutes-view:m1|minutes-saved')
  })
})

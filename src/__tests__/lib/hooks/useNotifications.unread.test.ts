import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useNotifications, type NotificationWithPayload } from '@/lib/hooks/useNotifications'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

/**
 * 受信トレイは新しい50件しか読んでいなかった。承認の依頼が50件を超えると、古い依頼が一覧に出ないまま
 * バッジの数だけ残る（本番で54件の依頼が届く人がいる）。未読は件数にかかわらず一覧に出す。
 */

const ORG = 'org-1'

type Call = [string, ...unknown[]]
type Result = { data?: unknown; error: { message: string } | null }

const state = vi.hoisted(() => ({
  selects: [] as Array<Array<[string, ...unknown[]]>>,
  recent: { data: [] as unknown, error: null } as { data?: unknown; error: { message: string } | null },
  unread: { data: [] as unknown, error: null } as { data?: unknown; error: { message: string } | null },
}))

function isUnreadQuery(calls: Call[]) {
  return calls.some(([method, column, value]) => method === 'is' && column === 'read_at' && value === null)
}

function makeSelectBuilder() {
  const calls: Call[] = []
  state.selects.push(calls)
  const builder: Record<string, unknown> = {}
  for (const method of ['eq', 'is', 'in', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve<Result>(isUnreadQuery(calls) ? state.unread : state.recent).then(resolve, reject)
  return builder
}

function makeUpdateBuilder() {
  const builder: Record<string, unknown> = {}
  for (const method of ['eq', 'is', 'in']) {
    builder[method] = () => builder
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => makeSelectBuilder(),
      update: () => makeUpdateBuilder(),
    }),
  }),
}))

vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: async () => ({ user: { id: 'me' }, error: null }),
  invalidateCachedUser: () => {},
}))

function makeNotification(id: string, createdAt: string, readAt: string | null): NotificationWithPayload {
  return {
    id,
    org_id: ORG,
    space_id: 'space-1',
    to_user_id: 'me',
    channel: 'in_app',
    type: 'review_request',
    dedupe_key: id,
    payload: { title: id },
    read_at: readAt,
    actioned_at: null,
    created_at: createdAt,
  } as NotificationWithPayload
}

let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  const value: ActiveOrgContextValue = {
    activeOrgId: ORG,
    activeOrgName: null,
    activeOrgRole: null,
    orgs: [],
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    switchOrg: () => {},
    loading: false,
  }
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(ActiveOrgContext.Provider, { value }, children)
  )
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  state.selects = []
  state.recent = { data: [], error: null }
  state.unread = { data: [], error: null }
})

describe('useNotifications — 未読は件数にかかわらず一覧に出す', () => {
  it('新しい50件に入らない古い未読も、一覧に出す', async () => {
    state.recent = {
      data: [
        makeNotification('newest', '2026-09-11T05:00:00Z', '2026-09-11T06:00:00Z'),
        makeNotification('newer', '2026-09-11T04:00:00Z', '2026-09-11T06:00:00Z'),
      ],
      error: null,
    }
    state.unread = { data: [makeNotification('old-unread', '2026-09-01T00:00:00Z', null)], error: null }

    const { result } = renderHook(() => useNotifications(), { wrapper })

    await waitFor(() => expect(result.current.notifications.map((n) => n.id)).toEqual(['newest', 'newer', 'old-unread']))
  })

  it('両方に入っている未読は1件にまとめ、新しい順に並べる', async () => {
    state.recent = {
      data: [
        makeNotification('a', '2026-09-11T05:00:00Z', '2026-09-11T06:00:00Z'),
        makeNotification('x', '2026-09-11T03:00:00Z', null),
      ],
      error: null,
    }
    state.unread = {
      data: [makeNotification('x', '2026-09-11T03:00:00Z', null), makeNotification('c', '2026-09-02T00:00:00Z', null)],
      error: null,
    }

    const { result } = renderHook(() => useNotifications(), { wrapper })

    await waitFor(() => expect(result.current.notifications.map((n) => n.id)).toEqual(['a', 'x', 'c']))
  })

  it('新しい50件と未読を同時に読む（未読は自分宛て・受信トレイ・組織で絞り、上限をつける）', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(state.selects).toHaveLength(2)
    const unread = state.selects.find(isUnreadQuery)
    const recent = state.selects.find((calls) => !isUnreadQuery(calls))
    expect(recent).toContainEqual(['limit', 50])
    expect(unread).toContainEqual(['eq', 'to_user_id', 'me'])
    expect(unread).toContainEqual(['eq', 'channel', 'in_app'])
    expect(unread).toContainEqual(['eq', 'org_id', ORG])
    expect(unread).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(unread).toContainEqual(['limit', 200])
  })

  it('未読の読み込みに失敗したら、一覧もエラーにする（一部だけ出して「全部読んだ」と見せない）', async () => {
    state.recent = { data: [makeNotification('a', '2026-09-11T05:00:00Z', null)], error: null }
    state.unread = { data: null, error: { message: 'boom' } }

    const { result } = renderHook(() => useNotifications(), { wrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
  })
})

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * Regression coverage for the empty-My-Tasks copy added as part of the
 * first-run UX stream (D): a user with no assigned tasks previously saw
 * only "担当しているタスクはありません" with no guidance on how tasks get
 * assigned to them.
 */

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: () => null,
}))

// Chainable stand-in for `supabase.from(...).select().eq().order()` — every
// query resolves to an empty result set so the page settles on tasks: [].
function makeChainable(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result)
        }
        return () => chainable
      },
    }
  )
  return chainable
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: vi.fn(() => makeChainable()),
    rpc: vi.fn(),
  }),
}))

function renderPage() {
  return render(
    <ActiveOrgContext.Provider
      value={{
        activeOrgId: 'org-1',
        activeOrgName: 'テスト組織',
        activeOrgRole: 'admin',
        orgs: [],
        switchOrg: vi.fn(),
        loading: false,
      }}
    >
      <MyTasksClient />
    </ActiveOrgContext.Provider>
  )
}

describe('MyTasksClient — 空状態の教育化 (初回UX改善 D)', () => {
  it('担当タスクが0件のとき、担当者設定への誘導文を表示する', async () => {
    renderPage()
    await waitFor(() =>
      expect(
        screen.getByText('担当者に設定されたタスクがここに表示されます。タスクの担当者欄から自分を設定してみましょう。')
      ).toBeInTheDocument()
    )
  })
})

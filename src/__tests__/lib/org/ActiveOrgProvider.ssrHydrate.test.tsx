import React, { act } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * ActiveOrgProvider の cookie 由来の activeOrgId (・loading) は、サーバーでは
 * 必ず null/true（document が無い）だが、cookie が既にあるブラウザでは
 * ハイドレーション時の最初の描画から実際の値が入ってしまう。この最小の差分
 * だけで、配下のどの設定画面でも React #418（サーバーとブラウザの最初の描画の
 * 食い違い）が起きていた。cookie の読み取り(getActiveOrgId)を phase で
 * 出し分け、Provider配下の実画面を実際に renderToString → hydrateRoot させて
 * 確認する（Providerの他のロジック・ユーザーとcookieの紐付けは変えていないので
 * useCurrentUser は「まだユーザー確定前」の状態に固定しておけば十分再現できる）。
 */

let phase: 'server' | 'client' = 'server'

vi.mock('@/lib/org/activeOrg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org/activeOrg')>()
  return {
    ...actual,
    getActiveOrgId: () => (phase === 'client' ? 'org-123' : null),
  }
})

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: true, error: null }),
}))

// 何を呼んでも「自分」を返し、await すると永遠に終わらない偽物（通信を起こさない）。
// 各画面が内部で使う supabase 経由のデータ取得(Slack連携・AI設定など)を
// phase に関係なく安定させ、今回の検証対象(cookie由来のactiveOrgId)以外の
// 差分が紛れ込まないようにする。
function chain(): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then') return () => {}
      return chain()
    },
    apply() {
      return chain()
    },
  })
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => chain() }))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings',
  useParams: () => ({}),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { ActiveOrgProvider } from '@/lib/org/ActiveOrgProvider'
import OrganizationSettingsPage from '@/app/settings/organization/page'
import BillingSettingsPage from '@/app/settings/billing/page'
import UserIntegrationsPage from '@/app/settings/integrations/page'
import OrgIntegrationsPage from '@/app/settings/org-integrations/page'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // fetch を直接使う hook（useIntegrations・useAiConfig等）が通信を起こさないようにする
  global.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
})

function tree(Page: React.ComponentType, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ActiveOrgProvider>
        <Page />
      </ActiveOrgProvider>
    </QueryClientProvider>
  )
}

async function renderThenHydrate(Page: React.ComponentType) {
  phase = 'server'
  const html = renderToString(tree(Page, new QueryClient()))

  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)

  const windowErrors: string[] = []
  const onWindowError = (e: ErrorEvent) => windowErrors.push(e.message)
  window.addEventListener('error', onWindowError)
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  phase = 'client'
  let root!: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(container, tree(Page, new QueryClient()))
  })

  const consoleErrors = consoleErrorSpy.mock.calls.map((call) => String(call[0]))
  consoleErrorSpy.mockRestore()
  window.removeEventListener('error', onWindowError)

  act(() => root.unmount())
  container.remove()
  return { consoleErrors, windowErrors }
}

describe('ActiveOrgProvider — cookie由来のactiveOrgIdによるReact #418が、配下のどの設定画面でも起きない', () => {
  it.each([
    ['組織設定', OrganizationSettingsPage],
    ['プランと請求', BillingSettingsPage],
    ['ツール連携', UserIntegrationsPage],
    ['組織の外部連携', OrgIntegrationsPage],
  ] as const)('%s画面: hydration時に食い違い警告が出ない', async (_label, Page) => {
    const { consoleErrors, windowErrors } = await renderThenHydrate(Page)
    expect(consoleErrors).toEqual([])
    expect(windowErrors).toEqual([])
  })
})

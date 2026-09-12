import React, { act, useContext, useSyncExternalStore } from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * ActiveOrgProvider の cookie 由来の activeOrgId・loading は、サーバーでは
 * 「document が無い」ため必ず null/true になる。cookie が既にあるブラウザでは
 * hydration 時の最初の描画からこの2つが確定しうるため、Provider は hydration が
 * 済むまでサーバーと同じ値に固定し、配下のどの画面でもサーバーとブラウザの
 * 最初の描画が一致するようにする。cookie の読み取り(getActiveOrgId)を phase で
 * 出し分け、Provider配下の実画面を実際に renderToString → hydrateRoot させて
 * 確認する（Providerの他のロジック・ユーザーとcookieの紐付けは変えていないので、
 * 以下の各画面のテストでは useCurrentUser を「まだユーザー確定前」の状態に
 * 固定すれば十分。ユーザー確定後の紐付けは下の別のdescribeで確認する）。
 */

let phase: 'server' | 'client' = 'server'

vi.mock('@/lib/org/activeOrg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org/activeOrg')>()
  return {
    ...actual,
    getActiveOrgId: () => (phase === 'client' ? 'org-123' : null),
  }
})

// useCurrentUser を外部ストア化し、テストの途中で「ユーザー未確定→確定」を
// 切り替えられるようにする（下の「hydration後の紐付け」テストで使う。
// 画面ごとのhydrationテストでは常に未確定のまま=デフォルト値を使う）
interface MockCurrentUserState {
  user: { id: string } | null
  loading: boolean
  error: null
}
let currentUserState: MockCurrentUserState = { user: null, loading: true, error: null }
const currentUserListeners = new Set<() => void>()
function setMockCurrentUser(next: MockCurrentUserState) {
  currentUserState = next
  currentUserListeners.forEach((listener) => listener())
}

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () =>
    useSyncExternalStore(
      (onStoreChange: () => void) => {
        currentUserListeners.add(onStoreChange)
        return () => currentUserListeners.delete(onStoreChange)
      },
      () => currentUserState,
      () => currentUserState,
    ),
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

import { ActiveOrgProvider, ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import OrganizationSettingsPage from '@/app/settings/organization/page'
import BillingSettingsPage from '@/app/settings/billing/page'
import UserIntegrationsPage from '@/app/settings/integrations/page'
import OrgIntegrationsPage from '@/app/settings/org-integrations/page'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // fetch を直接使う hook（useIntegrations・useAiConfig等）が通信を起こさないようにする
  global.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
})

beforeEach(() => {
  currentUserState = { user: null, loading: true, error: null }
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

describe('ActiveOrgProvider — hydration後にユーザーが確定しても、hydration時に確定したcookieの組織への紐付けが失われない', () => {
  it('ユーザー確定後もactiveOrgIdはcookieの組織のままで、「読み込み済みなのに組織が空」の描画が一度も無い', async () => {
    // Providerが配下に渡す値を、実際にコミットされた描画のたびに記録する
    // （render中のsetStateによる補正は同一描画パス内で完結するため、補正前の
    // 値がProbeまで伝播してコミットされることは無い。ここでは実際に一度も
    // 「読み込み済み(loading:false)なのに組織が無い(activeOrgId:null)」という
    // 中間状態が画面に出ないことを確かめる）
    const renderLog: string[] = []
    function Probe() {
      const ctx = useContext(ActiveOrgContext)
      renderLog.push(`${ctx.activeOrgId}|${ctx.loading}`)
      return <span data-testid="probe">{`${ctx.activeOrgId}|${ctx.loading}`}</span>
    }
    function probeTree(queryClient: QueryClient) {
      return (
        <QueryClientProvider client={queryClient}>
          <ActiveOrgProvider>
            <Probe />
          </ActiveOrgProvider>
        </QueryClientProvider>
      )
    }

    phase = 'server'
    const html = renderToString(probeTree(new QueryClient()))

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const windowErrors: string[] = []
    const onWindowError = (e: ErrorEvent) => windowErrors.push(e.message)
    window.addEventListener('error', onWindowError)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    phase = 'client'
    renderLog.length = 0
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, probeTree(new QueryClient()))
    })

    // hydration完了直後: cookieの組織(org-123)にまだ紐付いている(ユーザー未確定のため仮のスコープ)
    expect(container.textContent).toBe('org-123|false')

    // ユーザーが確定した後も、cookieで仮に使っていた組織への紐付けを引き継ぐ
    await act(async () => {
      setMockCurrentUser({ user: { id: 'user-1' }, loading: false, error: null })
    })
    expect(container.textContent).toBe('org-123|false')

    const consoleErrors = consoleErrorSpy.mock.calls.map((call) => String(call[0]))
    consoleErrorSpy.mockRestore()
    window.removeEventListener('error', onWindowError)

    expect(consoleErrors).toEqual([])
    expect(windowErrors).toEqual([])
    // 記録した全コミット描画の中に「読み込み済みなのに組織が空」が一度も無いこと
    expect(renderLog).not.toContain('null|false')

    act(() => root.unmount())
    container.remove()
  })
})

import React, { act } from 'react'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'

/**
 * サーバーの描画（HTML文字列）と、ブラウザ側のハイドレーション時の描画を実際に
 * 突き合わせるテスト。react-query の永続キャッシュ(IndexedDB)の復元は、ハイドレー
 * ションより先に終わることがあるため、サーバー側は「まだ何も取れていない」状態、
 * ブラウザ側は「キャッシュに既に中身がある」状態を再現し、React の食い違い警告
 * （#418）が出ないことを確かめる。
 *
 * useHydrated は実物（useSyncExternalStore）を使い、モックしない。他のデータ取得
 * hook だけを phase（'server'|'client'）で出し分ける。
 */

let phase: 'server' | 'client' = 'server'
let pathname = '/org1/secretary'
let params: Record<string, string> = { orgId: 'org1' }
// ブラウザ側（キャッシュ復元済み想定）にグループを1つ含めるかどうか。groups自体は
// hydration前は空(EMPTY_GROUPS)で描画されないため、サーバー側は常に空のまま
let includeGroupOnClient = false

// LeftNav.tsx の GROUP_COLLAPSED_KEY と同じ値（非公開の定数なのでテスト側で直接指定）
const GROUP_COLLAPSED_KEY = 'taskapp:sidebar:group-collapsed'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: () =>
    phase === 'server'
      ? { count: 0, pendingCount: 0, loading: true, error: null, refresh: vi.fn() }
      : { count: 5, pendingCount: 5, loading: false, error: null, refresh: vi.fn() },
}))
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () =>
    phase === 'server'
      ? { user: null, loading: true, error: null }
      : { user: { user_metadata: { name: 'テスト太郎' }, email: 'u@example.com' }, loading: false, error: null },
}))
vi.mock('@/lib/auth/signOutClient', () => ({ signOutAndLeave: vi.fn() }))
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces:
      phase === 'server'
        ? []
        : [
            {
              id: 'space1',
              name: 'テストプロジェクト',
              orgId: 'org1',
              orgName: 'テスト組織',
              role: 'admin',
              archivedAt: null,
              groupId: includeGroupOnClient ? 'group1' : null,
              sortOrder: 0,
            },
          ],
  }),
}))
vi.mock('@/lib/hooks/useSpaceGroups', () => ({
  useSpaceGroups: () => ({
    groups: phase === 'client' && includeGroupOnClient ? [{ id: 'group1', name: 'グループA', sortOrder: 0 }] : [],
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    reorderGroups: vi.fn(),
    moveSpaceToGroup: vi.fn(),
  }),
}))
vi.mock('@/components/onboarding/InternalOnboardingWalkthrough', () => ({
  resetInternalOnboarding: vi.fn(),
}))
vi.mock('@/components/onboarding/SetupChecklist', () => ({ resetSetupChecklist: vi.fn() }))

import { LeftNav } from '@/components/layout/LeftNav'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

// hydrateRoot を act() 経由で呼ぶための実行環境フラグ
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const serverOrgValue: ActiveOrgContextValue = {
  activeOrgId: null,
  activeOrgName: null,
  activeOrgRole: null,
  orgs: [],
  orgsStatus: 'unknown',
  orgsRefreshFailed: false,
  switchOrg: () => {},
  loading: true,
}

function tree(value: ActiveOrgContextValue) {
  return (
    <ActiveOrgContext.Provider value={value}>
      <LeftNav />
    </ActiveOrgContext.Provider>
  )
}

/**
 * サーバー描画→ブラウザでのハイドレーションを1往復させ、食い違い警告が
 * 出ないことと、ハイドレーション完了後の表示を返す。
 */
async function renderThenHydrate(clientOrgValue: ActiveOrgContextValue) {
  phase = 'server'
  const html = renderToString(tree(serverOrgValue))

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
    root = hydrateRoot(container, tree(clientOrgValue))
  })

  const consoleErrors = consoleErrorSpy.mock.calls.map((call) => String(call[0]))
  consoleErrorSpy.mockRestore()
  window.removeEventListener('error', onWindowError)

  const result = {
    windowErrors,
    consoleErrors,
    secretaryHref: container.querySelector('a[title="秘書"], a')
      ? Array.from(container.querySelectorAll('a')).find((a) => a.textContent === '秘書')?.getAttribute('href') ?? null
      : null,
    userName: container.textContent?.includes('テスト太郎') ?? false,
    projectName: container.textContent?.includes('テストプロジェクト') ?? false,
    orgName: container.textContent?.includes('テスト組織') ?? false,
    groupHeader: container.textContent?.includes('グループA') ?? false,
  }

  act(() => root.unmount())
  container.remove()
  return result
}

describe('LeftNav — サーバーの描画とハイドレーション時の描画の食い違いが無い（React #418）', () => {
  afterEach(() => {
    includeGroupOnClient = false
    localStorage.removeItem(GROUP_COLLAPSED_KEY)
  })

  it('/org1/secretary: cookie由来のactiveOrgIdがURLと異なっていても、食い違い警告は出ず、URLのorgIdで「秘書」が出る', async () => {
    pathname = '/org1/secretary'
    params = { orgId: 'org1' }

    const clientOrgValue: ActiveOrgContextValue = {
      ...serverOrgValue,
      activeOrgId: 'other-org',
      activeOrgName: '別組織',
      orgs: [{ orgId: 'other-org', orgName: '別組織', role: 'owner' }],
      orgsStatus: 'verified',
      loading: false,
    }

    const result = await renderThenHydrate(clientOrgValue)

    expect(result.consoleErrors).toEqual([])
    expect(result.windowErrors).toEqual([])
    expect(result.secretaryHref).toBe('/org1/secretary')
    expect(result.userName).toBe(true)
    expect(result.projectName).toBe(true)
  })

  it('/my: URLに組織IDが無く、hydration後に選択中の組織(cookie由来)が確定しても、食い違い警告は出ない', async () => {
    pathname = '/my'
    params = {}

    const clientOrgValue: ActiveOrgContextValue = {
      ...serverOrgValue,
      activeOrgId: 'org1',
      activeOrgName: 'テスト組織',
      orgs: [{ orgId: 'org1', orgName: 'テスト組織', role: 'owner' }],
      orgsStatus: 'verified',
      loading: false,
    }

    const result = await renderThenHydrate(clientOrgValue)

    expect(result.consoleErrors).toEqual([])
    expect(result.windowErrors).toEqual([])
    // hydration完了後は、確定した組織のもとで「秘書」が出る
    expect(result.secretaryHref).toBe('/org1/secretary')
    // 組織名の表示が「組織未設定」のまま止まらず、hydration後に実際の名前へ戻ることを確かめる
    expect(result.orgName).toBe(true)
  })

  it('ブラウザ側にグループが1つあり、localStorageで折りたたみ済みでも食い違い警告は出ず、hydration後は折りたたまれて描かれる', async () => {
    pathname = '/org1/project/space1'
    params = { orgId: 'org1', spaceId: 'space1' }
    includeGroupOnClient = true
    // groups自体はhydration前は空(EMPTY_GROUPS)で描画されないため、lazy useStateの
    // 初期値でこの値を読んでもサーバー側の描画とは食い違わない（LeftNav.tsx参照）
    localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify(['group1']))

    const clientOrgValue: ActiveOrgContextValue = {
      ...serverOrgValue,
      activeOrgId: 'org1',
      activeOrgName: 'テスト組織',
      orgs: [{ orgId: 'org1', orgName: 'テスト組織', role: 'owner' }],
      orgsStatus: 'verified',
      loading: false,
    }

    const result = await renderThenHydrate(clientOrgValue)

    expect(result.consoleErrors).toEqual([])
    expect(result.windowErrors).toEqual([])
    // グループ自体はhydration後に描かれる
    expect(result.groupHeader).toBe(true)
    // 折りたたみ済みなので、配下のプロジェクトは描かれない
    expect(result.projectName).toBe(false)
  })
})

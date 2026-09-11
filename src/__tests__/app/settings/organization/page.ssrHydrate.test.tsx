import React, { act } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'

/**
 * サーバーの描画（HTML文字列）と、ブラウザ側のハイドレーション時の描画を実際に
 * 突き合わせるテスト。
 *
 * ActiveOrgProvider の activeOrgId と loading はブラウザの cookie から同期的に
 * 決まるため、サーバーでは必ず activeOrgId:null / loading:true（document が無い）
 * だが、cookie が既にあるブラウザではハイドレーション時の最初の描画からこの2つが
 * 確定する。このページは useCurrentOrg().loading をそのまま描画に使っているため、
 * 「読み込み中の枠」と「組織名・役割バッジ・入力欄の編集可否まで入った本体」という
 * 別構造のDOMがサーバーとブラウザで食い違い、React #418 が発生していた
 * （orgName・role は cookie 由来ではなく所属一覧の取得結果から決まる値）。
 */

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    rpc: () => Promise.resolve({ error: null }),
  }),
}))

import OrganizationSettingsPage from '@/app/settings/organization/page'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

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
      <OrganizationSettingsPage />
    </ActiveOrgContext.Provider>
  )
}

async function renderThenHydrate(clientOrgValue: ActiveOrgContextValue) {
  const html = renderToString(tree(serverOrgValue))

  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)

  const windowErrors: string[] = []
  const onWindowError = (e: ErrorEvent) => windowErrors.push(e.message)
  window.addEventListener('error', onWindowError)
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

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
    orgName: container.textContent?.includes('Test Org') ?? false,
  }

  act(() => root.unmount())
  container.remove()
  return result
}

describe('OrganizationSettingsPage — サーバーの描画とハイドレーション時の描画の食い違いが無い（React #418）', () => {
  it('cookie由来のactiveOrgId/loadingに加え、所属一覧の取得も確定済みでハイドレーションしても、食い違い警告は出ない', async () => {
    const clientOrgValue: ActiveOrgContextValue = {
      ...serverOrgValue,
      activeOrgId: 'org-123',
      activeOrgName: 'Test Org',
      activeOrgRole: 'owner',
      orgs: [{ orgId: 'org-123', orgName: 'Test Org', role: 'owner' }],
      orgsStatus: 'verified',
      loading: false,
    }

    const result = await renderThenHydrate(clientOrgValue)

    expect(result.consoleErrors).toEqual([])
    expect(result.windowErrors).toEqual([])
    // hydration完了後は、確定した組織名が出る
    expect(result.orgName).toBe(true)
  })

  it('実際の原因の形（cookie由来のactiveOrgId/loadingだけがハイドレーション時に確定し、所属一覧はまだ取得中）でも、食い違い警告は出ない', async () => {
    // ActiveOrgProvider の実際の挙動: cookie の読み取りは同期的なのでactiveOrgId/loadingは
    // ハイドレーション時の最初の描画から確定するが、所属一覧(orgs)はネットワーク取得の
    // ため未確定のまま（orgName/roleもここから決まるのでnullのまま）。この最小の差分だけで
    // 食い違いが起きることを確かめる
    const clientOrgValue: ActiveOrgContextValue = {
      ...serverOrgValue,
      activeOrgId: 'org-123',
      loading: false,
    }

    const result = await renderThenHydrate(clientOrgValue)

    expect(result.consoleErrors).toEqual([])
    expect(result.windowErrors).toEqual([])
  })
})

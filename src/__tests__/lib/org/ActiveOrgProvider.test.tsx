import React, { useContext } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider, dehydrate } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Persister } from '@tanstack/react-query-persist-client'
import { ActiveOrgProvider, ActiveOrgContext, PAGE_LOADED_AT } from '@/lib/org/ActiveOrgProvider'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'

/**
 * ActiveOrgProvider（所属組織一覧＋いま選んでいる組織）。
 *
 * 'unknown' / 'cached' / 'verified' の判定は「今回のページ読み込み以降にネットワークで取れたか」
 * (dataUpdatedAt と PAGE_LOADED_AT の比較) で行う。以前は isFetchedAfterMount / status で
 * 判定しており、以下のような実運用でのズレがあった:
 * - IDB復元は「uidがまだ undefined → 復元後に判明」という順序で queryKey が切り替わるため、
 *   refetchOnMount:'always' のタイミングを素通りし、キャッシュが古いままでも一度も取り直さない
 * - uidが初回描画から判明しているケースでは、IDB復元によるhydrateだけで isFetchedAfterMount が
 *   true になり、フェッチが一度も走らないうちに 'verified' 扱いになってしまう
 * - 一度 verified になった後の再取得が失敗すると status が 'error' になり 'cached' に後退してしまう
 *
 * このテストは実際の PersistQueryClientProvider + dehydrate/restore の流れを使って、上記の
 * バグが再発しないことを検証する（`useCurrentUser` はモックせず、['currentUser'] クエリを
 * 実際に流し込んで再現する）。
 */

const USER = { id: 'user-1', email: 'u@example.com' }
const USER_B = { id: 'user-2', email: 'b@example.com' }

let membershipsResult: { data: unknown; error: unknown }
const orderMock = vi.fn(() => Promise.resolve(membershipsResult))
const fromMock = vi.fn(() => ({ select: () => ({ eq: () => ({ order: orderMock }) }) }))
const refreshSessionMock = vi.fn().mockResolvedValue({ data: {}, error: null })
const getAALMock = vi.fn().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } })
const getUserMock = vi.fn().mockResolvedValue({ data: { user: USER }, error: null })

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: fromMock,
    auth: {
      getUser: getUserMock,
      refreshSession: refreshSessionMock,
      mfa: {
        getAuthenticatorAssuranceLevel: getAALMock,
      },
    },
  }),
}))

let cookie: string | null = null
const setCookieMock = vi.fn((id: string) => { cookie = id })
vi.mock('@/lib/org/activeOrg', () => ({
  getActiveOrgId: () => cookie,
  setActiveOrgId: (id: string) => setCookieMock(id),
}))

function Probe() {
  const ctx = useContext(ActiveOrgContext)
  return (
    <div>
      <div data-testid="status">{ctx.orgsStatus}</div>
      <div data-testid="active">{ctx.activeOrgId ?? ''}</div>
      <div data-testid="count">{ctx.orgs.length}</div>
      <div data-testid="role">{ctx.activeOrgRole ?? ''}</div>
      <div data-testid="loading">{String(ctx.loading)}</div>
      <button onClick={() => ctx.switchOrg('org-2')}>switch</button>
    </div>
  )
}

const row = (id: string) => ({ org_id: id, role: 'owner', created_at: '2026-01-01', organizations: { name: id } })
const entry = (id: string) => ({ orgId: id, orgName: id, role: 'owner' })
const t = (id: string) => screen.getByTestId(id).textContent as string
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))
const NETERR = { data: null, error: { code: 'PGRST000', message: 'fetch failed' } }

function appClient() {
  // retryDelay:0 はテストを速くするためだけ（本番は react-query の既定の指数バックオフのまま）
  return new QueryClient({
    defaultOptions: { queries: { gcTime: 86_400_000, refetchOnWindowFocus: false, retry: 1, retryDelay: 0 } },
  })
}

/** ['orgMemberships', uid] を ageMs 前（PAGE_LOADED_AT 基準）に書かれたものとして永続化した塊を作る */
function persistedWith(orgIds: string[], ageMs: number, uid = USER.id) {
  const src = new QueryClient()
  src.setQueryData(['orgMemberships', uid], orgIds.map(entry), { updatedAt: PAGE_LOADED_AT - ageMs })
  return { timestamp: Date.now(), buster: 'b', clientState: dehydrate(src) }
}

/** QueryProvider.restoreClient を模す: 復元の途中で ['currentUser'] を後から知る */
function renderWithRestore(qc: QueryClient, persisted: unknown, user: typeof USER = USER) {
  const persister: Persister = {
    persistClient: async () => {},
    restoreClient: async () => {
      await Promise.resolve()
      qc.setQueryData(['currentUser'], user)
      return persisted as never
    },
    removeClient: async () => {},
  }
  return render(
    <PersistQueryClientProvider client={qc} persistOptions={{ persister, buster: 'b', maxAge: 86_400_000 }}>
      <ActiveOrgProvider><Probe /></ActiveOrgProvider>
    </PersistQueryClientProvider>
  )
}

/** 永続キャッシュ無し・['currentUser'] は最初から分かっている状態で描画する */
function renderPlain(qc: QueryClient, user: typeof USER | null = USER) {
  qc.setQueryData(['currentUser'], user)
  return render(
    <QueryClientProvider client={qc}>
      <ActiveOrgProvider><Probe /></ActiveOrgProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateCachedUser()
  cookie = 'org-1'
  membershipsResult = { data: [row('org-1'), row('org-2')], error: null }
  getUserMock.mockResolvedValue({ data: { user: USER }, error: null })
  refreshSessionMock.mockResolvedValue({ data: {}, error: null })
  getAALMock.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } })
  orderMock.mockImplementation(() => Promise.resolve(membershipsResult))
  window.history.pushState({}, '', '/org-1/project/s1')
})

describe('ActiveOrgProvider — 鮮度判定（dataUpdatedAt 基準）', () => {
  it.each([
    ['30秒前', 30_000],
    ['5分前', 5 * 60_000],
  ])('IDB永続キャッシュ(%s)は初回描画から cached・role も使え、1回だけ取り直して verified になる', async (_label, ageMs) => {
    // フェッチにわずかに時間をかけ、cached の瞬間を確実に観測できるようにする
    orderMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(membershipsResult), 20)))

    renderWithRestore(appClient(), persistedWith(['org-1'], ageMs))

    await waitFor(() => expect(t('count')).toBe('1'))
    expect(t('status')).toBe('cached')
    expect(t('role')).toBe('owner')

    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('uidが初回描画から判明していて、IDB復元がその後に来ても、フェッチが終わるまでverifiedにしない', async () => {
    orderMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(membershipsResult), 20)))

    const qc = appClient()
    qc.setQueryData(['currentUser'], USER) // 復元を待たずに最初から uid が判明している
    const persisted = persistedWith(['org-1'], 30_000)
    const persister: Persister = {
      persistClient: async () => {},
      restoreClient: async () => { await Promise.resolve(); return persisted as never },
      removeClient: async () => {},
    }
    render(
      <PersistQueryClientProvider client={qc} persistOptions={{ persister, buster: 'b', maxAge: 86_400_000 }}>
        <ActiveOrgProvider><Probe /></ActiveOrgProvider>
      </PersistQueryClientProvider>
    )

    await waitFor(() => expect(t('count')).toBe('1'))
    expect(t('status')).toBe('cached')

    await waitFor(() => expect(t('status')).toBe('verified'))
  })
})

describe('ActiveOrgProvider — 復元中に unscoped の activeOrgId を出さない（perf回帰）', () => {
  // cookie が既にある（＝以前どの組織を見ていたか分かっている）のに、IDB 復元が終わるまでの
  // 一瞬だけ loading:false・activeOrgId:null を出してしまうと、/my・通知などの
  // 「!orgLoading になったら取得を始める」勢が無所属スコープで先に1回走り、
  // 復元完了後にもう一度スコープ付きで走る（1リロードあたり数リクエスト分の無駄・
  // 別組織のタスクが一瞬見える恐れ）。waitFor ではなく、コミットされた
  // レンダーを毎回記録して「そのレンダーが実在したか」を確認する。
  it('cookie=org-1 + IDB復元中でも、コミットされる最初のレンダーから activeOrgId は org-1', async () => {
    const log: Array<{ loading: boolean; activeOrgId: string | null }> = []
    function Recorder() {
      const ctx = useContext(ActiveOrgContext)
      log.push({ loading: ctx.loading, activeOrgId: ctx.activeOrgId })
      return null
    }

    const qc = appClient()
    const persisted = persistedWith(['org-1', 'org-2'], 30_000)
    const persister: Persister = {
      persistClient: async () => {},
      restoreClient: async () => {
        await Promise.resolve()
        qc.setQueryData(['currentUser'], USER)
        return persisted as never
      },
      removeClient: async () => {},
    }
    render(
      <PersistQueryClientProvider client={qc} persistOptions={{ persister, buster: 'b', maxAge: 86_400_000 }}>
        <ActiveOrgProvider><Recorder /></ActiveOrgProvider>
      </PersistQueryClientProvider>
    )

    await waitFor(() => expect(log.some((s) => s.activeOrgId === 'org-1')).toBe(true))

    // 最初にコミットされたレンダーから既に org-1（cookie 由来）
    expect(log[0]).toEqual({ loading: false, activeOrgId: 'org-1' })
    // loading:false なのに activeOrgId:null という「無所属スコープ」レンダーが一度も無い
    expect(log.some((s) => s.loading === false && s.activeOrgId === null)).toBe(false)
  })
})

describe('ActiveOrgProvider — loading', () => {
  it('cookieがあれば、ユーザー確定前（IDB復元中）から一貫してloadingはfalse', async () => {
    const log: boolean[] = []
    function Recorder() {
      const ctx = useContext(ActiveOrgContext)
      log.push(ctx.loading)
      return null
    }
    const qc = appClient()
    const persisted = persistedWith(['org-1'], 30_000)
    const persister: Persister = {
      persistClient: async () => {},
      restoreClient: async () => {
        await Promise.resolve()
        qc.setQueryData(['currentUser'], USER)
        return persisted as never
      },
      removeClient: async () => {},
    }
    render(
      <PersistQueryClientProvider client={qc} persistOptions={{ persister, buster: 'b', maxAge: 86_400_000 }}>
        <ActiveOrgProvider><Recorder /></ActiveOrgProvider>
      </PersistQueryClientProvider>
    )

    await sleep(50)
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((v) => v === false)).toBe(true)
  })

  it('cookieが無ければ、ユーザー確定 → 所属一覧の初回取得完了までloadingはtrueのまま', async () => {
    cookie = null
    orderMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(membershipsResult), 20)))
    const qc = appClient()
    renderPlain(qc)

    // ユーザーは最初から分かっているが、所属一覧の初回取得（20ms delay）がまだ終わっていない間はtrue
    expect(t('loading')).toBe('true')
    expect(t('status')).toBe('unknown')

    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(t('loading')).toBe('false')
  })
})

describe('ActiveOrgProvider — verified後の再取得失敗は後退しない', () => {
  it('cookieなし: 再取得が失敗してもverifiedのまま・activeOrgIdは変わらない', async () => {
    cookie = null
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(t('status')).toBe('verified'))
    const before = t('active')
    expect(before).toBe('org-1')

    membershipsResult = NETERR
    await act(async () => { await qc.refetchQueries({ queryKey: ['orgMemberships'] }) })

    expect(t('status')).toBe('verified')
    expect(t('active')).toBe(before)
  })

  it('stale cookie: 再取得が失敗してもverifiedのまま・activeOrgIdは変わらない', async () => {
    cookie = 'org-stale'
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(t('status')).toBe('verified'))
    const before = t('active')
    expect(before).toBe('org-1') // フォールバック済み

    membershipsResult = NETERR
    await act(async () => { await qc.refetchQueries({ queryKey: ['orgMemberships'] }) })

    expect(t('status')).toBe('verified')
    expect(t('active')).toBe(before)
  })
})

describe('ActiveOrgProvider — cookie無し・キャッシュ一覧のみのとき', () => {
  it('初回描画から先頭orgを仮のスコープにする。cookie書き込みはverifiedになるまで行わない', async () => {
    cookie = null
    orderMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(membershipsResult), 20)))
    const qc = appClient()
    renderWithRestore(qc, persistedWith(['org-1', 'org-2'], 30_000))

    await waitFor(() => expect(t('count')).toBe('2'))
    expect(t('status')).toBe('cached')
    expect(t('active')).toBe('org-1')
    expect(setCookieMock).not.toHaveBeenCalled()

    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(setCookieMock).toHaveBeenCalledWith('org-1')
  })
})

describe('ActiveOrgProvider — verifiedで所属0件', () => {
  it('cookieがあってもactiveOrgIdはnull', async () => {
    cookie = 'org-1'
    membershipsResult = { data: [], error: null }
    const qc = appClient()
    renderPlain(qc)

    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(t('active')).toBe('')
  })
})

describe('ActiveOrgProvider — switchOrg', () => {
  it('再取得の成功・失敗をまたいで選択が保持され、cookie書き込みは1回だけ', async () => {
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(t('status')).toBe('verified'))

    fireEvent.click(screen.getByText('switch'))
    expect(t('active')).toBe('org-2')

    await act(async () => { await qc.refetchQueries({ queryKey: ['orgMemberships'] }) })
    expect(t('active')).toBe('org-2')

    membershipsResult = NETERR
    await act(async () => { await qc.refetchQueries({ queryKey: ['orgMemberships'] }) })
    expect(t('active')).toBe('org-2')

    expect(setCookieMock).toHaveBeenCalledTimes(1)
    expect(setCookieMock).toHaveBeenCalledWith('org-2')
  })
})

describe('ActiveOrgProvider — ユーザー切り替え（リロード無し）', () => {
  // react-query のキャッシュはユーザーIDでキー分けされている（['orgMemberships', uid]）ため、
  // 所属一覧データ自体がユーザーを跨いで混ざることはない。ここで検証したいのは、
  // `rawActiveOrgId`（ローカル state で持つ「いま選んでいるorg」）がユーザーIDに紐付いておらず、
  // サインアウト→別ユーザーでサインイン（リロード無し）をした瞬間に前のユーザーの選択が
  // 一瞬でも新しいユーザーの activeOrgId として出てしまわないこと
  it('別ユーザーに切り替わったら、前のユーザーが選んだorgを引き継がない', async () => {
    const qc = appClient()
    renderPlain(qc, USER)
    await waitFor(() => expect(t('status')).toBe('verified'))
    fireEvent.click(screen.getByText('switch')) // Aがorg-2を選ぶ
    expect(t('active')).toBe('org-2')

    // Bの一覧の取得にわずかに時間をかけ、「uidは切り替わったが確認はまだ」の瞬間を
    // waitFor で確実に観測できるようにする
    membershipsResult = { data: [row('org-9')], error: null }
    orderMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(membershipsResult), 20)))

    // Bがサインイン（リロード無し）
    act(() => { qc.setQueryData(['currentUser'], USER_B) })

    // uid が切り替わった直後（Bの一覧はまだ確認できていない）でも、Aの選択(org-2)が漏れていない
    await waitFor(() => expect(t('count')).toBe('0'))
    expect(t('active')).not.toBe('org-2')

    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(t('active')).toBe('org-9')
    expect(t('count')).toBe('1')
  })
})

describe('ActiveOrgProvider — ログアウト状態で開いた後にサインイン', () => {
  // /login をフルリロードで開く（セッション切れ等）と、最初に確定する「ユーザー」は null。
  // 以前の実装は「最初に判明したユーザー」= null の時点で cookie 紐付けを一度きり試みて
  // 何もしない（currentUserId が falsy で弾かれる）ため、その後サインインしても二度と
  // cookie が紐付けられず、有効な org-2 の cookie があるのに orgs[0]（org-1）へ
  // フォールバックしてしまっていた。cookie は「最初に判明した非nullユーザー」に紐付けるのが正しい
  it('ログアウト表示中に開いたページで後からサインインしても、起動時のcookieが有効な所属なら使われる', async () => {
    cookie = 'org-2'
    membershipsResult = { data: [row('org-1'), row('org-2')], error: null }
    const qc = appClient()
    renderPlain(qc, null) // ログアウト状態で開く

    expect(t('active')).toBe('')

    // Aがサインイン（リロード無し。LoginClient は router.push で遷移するのでフルリロードではない）
    act(() => { qc.setQueryData(['currentUser'], USER) })

    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(t('active')).toBe('org-2')
    // 有効な cookie だったので書き換えは発生しない
    expect(setCookieMock).not.toHaveBeenCalled()
  })
})

describe('ActiveOrgProvider — retry（再試行）', () => {
  it('一時的なエラーは1回だけ再試行される', async () => {
    let calls = 0
    orderMock.mockImplementation(() => {
      calls++
      if (calls === 1) return Promise.resolve(NETERR)
      return Promise.resolve(membershipsResult)
    })
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(t('status')).toBe('verified'))
    expect(calls).toBe(2)
  })

  it('42501（二要素認証未入力）は再試行せず、古いセッションの確認を1回だけ行う', async () => {
    membershipsResult = { data: null, error: { code: '42501', message: 'mfa_required' } }
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(refreshSessionMock).toHaveBeenCalledTimes(1))
    await sleep(50)
    expect(getAALMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledTimes(1) // 再試行していない
  })

  it('対象外パス（/login/mfa）では古いセッションの確認自体を行わない', async () => {
    window.history.pushState({}, '', '/login/mfa')
    membershipsResult = { data: null, error: { code: '42501', message: 'mfa_required' } }
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(fromMock).toHaveBeenCalledTimes(1))
    await sleep(50)
    expect(refreshSessionMock).not.toHaveBeenCalled()
  })

  // 最後に置く: aal2 への遷移が必要と判定されると、モジュール内の `redirectingToMfa`
  // シングルトンが以後 true のまま固定される（無限リダイレクト防止のため意図的）。
  // 後続のテストの前提（refreshSession/getAAL が呼ばれること）を壊さないよう最後に置く
  it('aal2への遷移が必要なら location.assign が1回だけ呼ばれる', async () => {
    membershipsResult = { data: null, error: { code: '42501', message: 'mfa_required' } }
    getAALMock.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } })
    window.history.pushState({}, '', '/org-1/project/s1')
    // jsdom の window.location.assign は再定義不可（configurable:false）のため、
    // window.location ごと（pathname/search はそのまま引き継いだ）差し替える
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    })
    const qc = appClient()
    renderPlain(qc)
    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1))
    expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining('/login/mfa'))
  })
})

import React, { useEffect, useReducer } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useQueryClient, dehydrate, QueryClient as RQQueryClient, type QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { QueryProvider, PERSIST_BUSTER } from '@/components/providers/QueryProvider'

type AuthEvent = 'SIGNED_OUT' | 'SIGNED_IN' | 'INITIAL_SESSION' | 'TOKEN_REFRESHED' | 'MFA_CHALLENGE_VERIFIED'
type Session = { user: { id: string; email?: string } } | null

let authCallback: (event: AuthEvent, session: Session) => void = () => {}
const mockUnsubscribe = vi.fn()
const mockGetSession = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (cb: (event: AuthEvent, session: Session) => void) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
      },
    },
  }),
}))

const mockClearActiveOrgId = vi.fn()
vi.mock('@/lib/org/activeOrg', () => ({
  clearActiveOrgId: (...args: unknown[]) => mockClearActiveOrgId(...args),
}))

// signOutAndLeave() 自身が既にフルページ遷移するため、その最中に onAuthStateChange の
// SIGNED_OUT が発火しても二重リロードしないようにするためのガード。既定は false（実行中でない）
let mockSignOutInProgress = false
vi.mock('@/lib/auth/signOutClient', () => ({
  isSignOutInProgress: () => mockSignOutInProgress,
}))

const idbGet = vi.fn()
const idbSet = vi.fn()
const idbDel = vi.fn()
const idbKeys = vi.fn()

vi.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => idbGet(...args),
  set: (...args: unknown[]) => idbSet(...args),
  del: (...args: unknown[]) => idbDel(...args),
  keys: (...args: unknown[]) => idbKeys(...args),
}))

const LEGACY_KEY = 'taskapp-query-cache'
const scopedKey = (uid: string) => `${LEGACY_KEY}:${uid}`

/** Build a realistic PersistedClient payload using the real `dehydrate()`,
 *  instead of hand-rolling the internal dehydrated-query shape.
 *  Stamps the current PERSIST_BUSTER by default so restore tests still
 *  hydrate; pass a stale buster to simulate a cache written by an older
 *  build (which must be discarded on restore). */
function buildPersistedClient(
  entries: Array<{ queryKey: unknown[]; data: unknown }>,
  buster: string = PERSIST_BUSTER,
): PersistedClient {
  const qc = new RQQueryClient()
  for (const entry of entries) {
    qc.setQueryData(entry.queryKey, entry.data)
  }
  return {
    timestamp: Date.now(),
    buster,
    clientState: dehydrate(qc),
  }
}

function sessionFor(uid: string): Session {
  return { user: { id: uid, email: `${uid}@example.com` } }
}

// Reads directly from the query cache instead of using `useQuery` — a real
// `useQuery({ queryKey: [...] })` would attempt its own background fetch
// (there is no queryFn registered here), racing with and overwriting the
// values under test. This probe only observes cache writes made via
// setQueryData / hydrate / the QueryProvider auth listener.
function Probe({ onClient }: { onClient: (qc: QueryClient) => void }) {
  const qc = useQueryClient()
  const [, forceRender] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    onClient(qc)
    const unsubscribe = qc.getQueryCache().subscribe(() => forceRender())
    return unsubscribe
  }, [qc, onClient])
  const data = qc.getQueryData<{ id: string } | null>(['currentUser'])
  return <div data-testid="user">{data === null ? 'null' : data ? data.id : 'undefined'}</div>
}

describe('QueryProvider', () => {
  let capturedClient: QueryClient | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    capturedClient = null
    idbGet.mockResolvedValue(undefined)
    idbKeys.mockResolvedValue([])
    mockGetSession.mockResolvedValue({ data: { session: null } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderProvider() {
    return render(
      <QueryProvider>
        <Probe onClient={(qc) => { capturedClient = qc }} />
      </QueryProvider>
    )
  }

  // --- CRITICAL: cross-tenant leak regression -----------------------------
  it('never restores another user\'s data on a cross-load user switch (A closes tab, B signs in)', async () => {
    // A's scoped IDB entry, AND (simulating leftover data from the earlier
    // buggy "single fixed key" design) the legacy unscoped key — both
    // contain A's private data.
    const aData = buildPersistedClient([
      { queryKey: ['userSpaces', 'user-A', false], data: [{ id: 'space-A-secret' }] },
    ])
    idbGet.mockImplementation(async (key: string) => {
      if (key === scopedKey('user-A')) return aData
      if (key === LEGACY_KEY) return aData
      return undefined
    })
    // The browser now has user B's session (A never signed out; B signed in
    // on the same device).
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-B') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).not.toBe(undefined)
    })

    // B's identity is what's seeded...
    expect(capturedClient!.getQueryData<{ id: string }>(['currentUser'])?.id).toBe('user-B')
    // ...and A's private data must never have entered B's cache, via either
    // the scoped-for-A key or the legacy unscoped key.
    expect(capturedClient!.getQueryData(['userSpaces', 'user-A', false])).toBe(undefined)
    expect(idbGet).not.toHaveBeenCalledWith(LEGACY_KEY)
  })

  // --- same-user restore must still work (anti "空振り" regression) -------
  it('restores the current user\'s own persisted cache (same-user reload)', async () => {
    const aData = buildPersistedClient([
      { queryKey: ['userSpaces', 'user-A', false], data: [{ id: 'space-A-1' }] },
    ])
    idbGet.mockImplementation(async (key: string) => {
      if (key === scopedKey('user-A')) return aData
      return undefined
    })
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient!.getQueryData(['userSpaces', 'user-A', false])).toEqual([
        { id: 'space-A-1' },
      ])
    })
  })

  // --- no session → default-deny -------------------------------------------
  it('restores nothing and never touches IDB when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    renderProvider()

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).toBe(null)
    })

    // Only the one-time legacy-key purge (`del`) may touch IDB; restoreClient
    // itself must never call `get` while uid is unknown.
    expect(idbGet).not.toHaveBeenCalled()
  })

  // --- PII exclusion ---------------------------------------------------------
  it('never persists the currentUser query to IDB (excluded from dehydrate)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).not.toBe(undefined)
    })

    // Trigger a persist by writing some other query; retry until the
    // subscription (attached after the async restore resolves) is live.
    await waitFor(() => {
      act(() => {
        capturedClient!.setQueryData(['userSpaces', 'user-A', false], [{ id: 's1' }])
      })
      expect(idbSet).toHaveBeenCalled()
    })

    for (const [, persistedClient] of idbSet.mock.calls as Array<[string, PersistedClient]>) {
      const hasCurrentUser = persistedClient.clientState.queries.some(
        (q) => q.queryKey[0] === 'currentUser'
      )
      expect(hasCurrentUser).toBe(false)
    }
  })

  // ファイル一覧の「検索結果」は、打鍵の切れ目ごとに別キーが生まれ、1件あたり最大500件ぶんの
  // 本文を含む。IDB が肥大すると他ページの初回描画まで遅くなるので永続しない。
  // 全件一覧(検索なし)はキャッシュ優先で即描画したいので、そちらは永続する。
  it('ファイル一覧の検索結果は IDB に載せず、全件一覧は載せる', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    await waitFor(() => {
      act(() => {
        capturedClient!.setQueryData(['files', 'space-1', 'v2'], { files: [{ id: 'f1' }], hasMore: false })
        capturedClient!.setQueryData(['files', 'space-1', 'v2', 'search', { q: '請求' }], {
          files: [{ id: 'f2' }],
          hasMore: false,
        })
      })
      expect(idbSet).toHaveBeenCalled()
    })

    const persisted = (idbSet.mock.calls as Array<[string, PersistedClient]>).at(-1)![1]
    const keys = persisted.clientState.queries.map((q) => q.queryKey)

    expect(keys).toContainEqual(['files', 'space-1', 'v2'])
    expect(keys.some((k) => k[0] === 'files' && k[3] === 'search')).toBe(false)
  })

  // GitHub Issue の紐付け候補検索(useIssueLinkCandidates)は、打鍵の切れ目ごとに
  // 別キーが生まれる検索結果を IDB に載せない。空の検索語(候補の一覧)は載せてよい
  // （表示速度レビューでの是正・ファイル検索と同じ理由・2026-09-11）。
  it('GitHub Issue の紐付け候補検索は IDB に載せず、空の検索は載せる', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    await waitFor(() => {
      act(() => {
        capturedClient!.setQueryData(['space-github-issue-candidates', ['repo-1'], ''], [{ id: 'i1' }])
        capturedClient!.setQueryData(['space-github-issue-candidates', ['repo-1'], '42'], [{ id: 'i2' }])
      })
      expect(idbSet).toHaveBeenCalled()
    })

    const persisted = (idbSet.mock.calls as Array<[string, PersistedClient]>).at(-1)![1]
    const keys = persisted.clientState.queries.map((q) => q.queryKey)

    expect(keys).toContainEqual(['space-github-issue-candidates', ['repo-1'], ''])
    expect(
      keys.some((k) => k[0] === 'space-github-issue-candidates' && k[2] === '42')
    ).toBe(false)
  })

  // --- legacy-key migration ---------------------------------------------------
  it('purges the legacy unscoped IDB key on startup', async () => {
    renderProvider()

    await waitFor(() => {
      expect(idbDel).toHaveBeenCalledWith(LEGACY_KEY)
    })
  })

  // --- SIGNED_OUT clears everything (existing regression) --------------------
  it('deletes all taskapp-query-cache* IDB keys on SIGNED_OUT', async () => {
    idbKeys.mockResolvedValue([
      'taskapp-query-cache',
      'taskapp-query-cache:user-A',
      'taskapp-query-cache:user-B',
      'some-other-app-key',
    ])
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()
    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(idbDel).toHaveBeenCalledWith('taskapp-query-cache:user-A')
    })
    expect(idbDel).toHaveBeenCalledWith('taskapp-query-cache')
    expect(idbDel).toHaveBeenCalledWith('taskapp-query-cache:user-B')
    expect(idbDel).not.toHaveBeenCalledWith('some-other-app-key')
  })

  // --- SIGNED_OUT also clears the active-org cookie ---------------------------
  // 以前は SIGNED_OUT でキャッシュ(IDB/react-query)だけを消しており、active org の cookie は
  // 残っていた。サインアウト→別ユーザーでサインイン（リロード無し）をすると、Bの最初の描画で
  // Aが選んでいた org id の cookie がそのまま読まれてしまう（ActiveOrgProvider は cookie を
  // 「まだ知らないユーザーの初回選択」として一度だけ信用するため）。clearActiveOrgId() が
  // 存在するのに呼ばれていなかった（src/lib/org/activeOrg.ts）
  it('clears the active-org cookie on SIGNED_OUT', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    renderProvider()
    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(mockClearActiveOrgId).toHaveBeenCalledTimes(1)
    })
  })

  // --- currentUser stays in sync with auth events -----------------------------
  it('sets currentUser query data to null on SIGNED_OUT', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const { getByTestId } = renderProvider()

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-A')
    })

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('null')
    })
  })

  // --- cache-buster: stale-shape persisted cache is discarded, not hydrated -
  // Regression for the production crash where a query changed persisted data
  // shape (channelMessages: ChannelMessageRow[] via useQuery → InfiniteData
  // via useInfiniteQuery) while keeping the same queryKey. Returning users'
  // old array-shaped entry hydrated into the InfiniteQueryObserver and threw
  // `Cannot read properties of undefined (reading 'length')`. A buster bump
  // must drop the whole stale blob so no incompatible shape is ever restored.
  it('discards a persisted cache written under a stale buster (does not hydrate old-shape entries)', async () => {
    // Old build's cache: array-shaped channelMessages (the pre-infinite shape)
    // stamped with a buster that no longer matches the current one.
    const staleData = buildPersistedClient(
      [{ queryKey: ['channelMessages', 'org-1', 'space-1'], data: [{ id: 'm1' }, { id: 'm2' }] }],
      'stale-old-buster',
    )
    idbGet.mockImplementation(async (key: string) => {
      if (key === scopedKey('user-A')) return staleData
      return undefined
    })
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).not.toBe(undefined)
    })

    // The stale entry must NOT be present in the cache (whole blob discarded).
    expect(capturedClient!.getQueryData(['channelMessages', 'org-1', 'space-1'])).toBe(undefined)
    // And the stale user-scoped blob is removed from IDB on buster mismatch.
    await waitFor(() => {
      expect(idbDel).toHaveBeenCalledWith(scopedKey('user-A'))
    })
  })

  it('still restores a persisted cache stamped with the current buster', async () => {
    // Same key, but written by the current build (matching buster) → restored.
    const freshData = buildPersistedClient([
      { queryKey: ['userSpaces', 'user-A', false], data: [{ id: 'space-A-1' }] },
    ]) // defaults to PERSIST_BUSTER
    idbGet.mockImplementation(async (key: string) => {
      if (key === scopedKey('user-A')) return freshData
      return undefined
    })
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient!.getQueryData(['userSpaces', 'user-A', false])).toEqual([
        { id: 'space-A-1' },
      ])
    })
  })

  it('PERSIST_BUSTER is a stable non-empty constant (not a build hash)', () => {
    // A build-hash buster would wipe every user's cache on every deploy,
    // defeating persistence. It must be a hand-bumped constant.
    expect(typeof PERSIST_BUSTER).toBe('string')
    expect(PERSIST_BUSTER.length).toBeGreaterThan(0)
  })

  // --- freshness tiers: refetchOnWindowFocusはアプリ全体では無効化しない -------------
  // ball ownership(誰の番か)の唯一の更新経路であるuseTasks/useMeetings(realtime/ポーリング
  // 無し)がフォーカス再取得に依拠しているため、ルート集約された単一QueryProviderで
  // refetchOnWindowFocus:false にするとその経路ごと奪ってしまう(code review指摘で撤回)。
  // ちらつきの根因はremount+isFetching描画であり、layout永続化+STRUCTURE staleTime+
  // isPending描画規約で別途解消する。ここでは既定(false固定化しない)ことだけを保証する。
  it('does not force refetchOnWindowFocus to false in the default query options', async () => {
    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    expect(capturedClient!.getDefaultOptions().queries?.refetchOnWindowFocus).not.toBe(false)
  })

  it('updates currentUser query data on SIGNED_IN / TOKEN_REFRESHED', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const { getByTestId } = renderProvider()

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-A')
    })

    act(() => {
      authCallback('TOKEN_REFRESHED', sessionFor('user-A'))
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-A')
    })

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-B'))
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-B')
    })
  })

  // --- MFA recovery: 二要素認証コード入力後は orgMemberships を必ず取り直す ------------------
  // パスワードログイン直後（aal1）は org_memberships が 42501 で失敗し、/login/mfa は門番の
  // 対象外パスなのでリダイレクトも起きない。そのままコード入力を終えて router.replace で
  // 戻っても（フルリロードではないため）ActiveOrgProvider は再マウントされず、
  // orgsStatus は 'unknown' のまま固定されてしまう（ApiSettings が「権限を確認中...」を
  // 永久に出し続ける）。MFA_CHALLENGE_VERIFIED を受けたら明示的に取り直す
  it('invalidates orgMemberships on MFA_CHALLENGE_VERIFIED', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    renderProvider()
    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    const invalidateSpy = vi.spyOn(capturedClient!, 'invalidateQueries')

    act(() => {
      authCallback('MFA_CHALLENGE_VERIFIED', sessionFor('user-A'))
    })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orgMemberships'] })
    })
  })

  // 通常の SIGNED_IN（タブ再フォーカス等でも supabase-js が発火し得る）では取り直さない。
  // ユーザー識別の変化はキャッシュクリアで既に処理済みなので、ここでも取り直すとフォーカスの
  // たびに毎回フェッチが増える
  it('does NOT invalidate orgMemberships on plain SIGNED_IN', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    renderProvider()
    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    const invalidateSpy = vi.spyOn(capturedClient!, 'invalidateQueries')

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-A'))
    })

    // 他の非同期処理が終わるのを一拍待ってから、呼ばれていないことを確認する
    await waitFor(() => {
      expect(capturedClient!.getQueryData<{ id: string }>(['currentUser'])?.id).toBe('user-A')
    })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['orgMemberships'] })
  })
})

// --- ハードリセット: ログアウト/別ユーザーへのサインインをフルリロード無しで行うと、
// ルート常駐のクライアント状態（ActiveOrgProvider・query observer・モジュール変数）が前の
// ユーザーのデータを持ったまま残ってしまう。signOutAndLeave() 経由のログアウトは自身で
// フルページ遷移するため対象外（isSignOutInProgress() で判定）。それ以外の経路
// （フォーム外でセッションが切れた等）で SIGNED_OUT / ユーザー識別変化を検知したときは、
// 保護されたページ（未ログインで開けるページ以外）にいる場合だけ、ここでフルリロードする。
describe('QueryProvider — 認証状態変化でのハードリセット', () => {
  const originalLocation = window.location

  function stubLocation(pathname: string) {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname, reload: reloadSpy },
      writable: true,
      configurable: true,
    })
    return reloadSpy
  }

  function Probe({ onClient }: { onClient: (qc: QueryClient) => void }) {
    const qc = useQueryClient()
    useEffect(() => {
      onClient(qc)
    }, [qc, onClient])
    return null
  }

  function renderProvider() {
    let client: QueryClient | null = null
    render(
      <QueryProvider>
        <Probe onClient={(qc) => { client = qc }} />
      </QueryProvider>
    )
    return () => client
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSignOutInProgress = false
    idbGet.mockResolvedValue(undefined)
    idbKeys.mockResolvedValue([])
    mockGetSession.mockResolvedValue({ data: { session: null } })
    sessionStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('保護されたページで SIGNED_OUT を検知したらフルリロードする', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('/login など未ログインで開けるページでは SIGNED_OUT でもリロードしない', async () => {
    const reloadSpy = stubLocation('/login')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    // clearActiveOrgId 等、他の同期処理が終わるのを一拍待つ
    await waitFor(() => {
      expect(mockClearActiveOrgId).toHaveBeenCalled()
    })
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('signOutAndLeave() 実行中（自分でフルページ遷移する）はリロードしない（二重リロード防止）', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockSignOutInProgress = true
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(mockClearActiveOrgId).toHaveBeenCalled()
    })
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('保護されたページで SIGNED_IN のユーザー識別が変わったらフルリロードする（A→B）', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())
    await waitFor(() => expect(getClient()!.getQueryData(['currentUser'])).not.toBe(undefined))

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-B'))
    })

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('同一ユーザーの SIGNED_IN（A→A）ではリロードしない', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())
    await waitFor(() => expect(getClient()!.getQueryData(['currentUser'])).not.toBe(undefined))

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-A'))
    })

    await waitFor(() => {
      expect(getClient()!.getQueryData<{ id: string }>(['currentUser'])?.id).toBe('user-A')
    })
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('初回セッション確立（null→B）ではリロードしない（サインイン識別の"変化"ではないため）', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())
    await waitFor(() => expect(getClient()!.getQueryData(['currentUser'])).toBe(null))

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-B'))
    })

    await waitFor(() => {
      expect(getClient()!.getQueryData<{ id: string }>(['currentUser'])?.id).toBe('user-B')
    })
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('10秒以内の連続トリガーは2回目以降リロードしない（sessionStorage の時間ガード）', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())

    act(() => {
      authCallback('SIGNED_OUT', null)
    })
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))

    // 直後にもう一度 SIGNED_OUT（例: 何らかの理由でイベントが重複発火）
    act(() => {
      authCallback('SIGNED_OUT', null)
    })
    await waitFor(() => expect(mockClearActiveOrgId).toHaveBeenCalledTimes(2))
    // ガードにより2回目はリロードされない
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('10秒経過後の再トリガーは再びリロードする', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const dateSpy = vi.spyOn(Date, 'now')
    try {
      dateSpy.mockReturnValue(1_000_000)
      const getClient = renderProvider()
      await waitFor(() => expect(getClient()).not.toBeNull())

      act(() => {
        authCallback('SIGNED_OUT', null)
      })
      await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))

      dateSpy.mockReturnValue(1_000_000 + 10_000)
      act(() => {
        authCallback('SIGNED_OUT', null)
      })
      await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(2))
    } finally {
      dateSpy.mockRestore()
    }
  })

  it('sessionStorage が使えなくても（例外を投げても）リロードは続行する', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sessionStorage blocked (private browsing)')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sessionStorage blocked (private browsing)')
    })
    try {
      const getClient = renderProvider()
      await waitFor(() => expect(getClient()).not.toBeNull())

      act(() => {
        authCallback('SIGNED_OUT', null)
      })

      await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))
    } finally {
      getItemSpy.mockRestore()
      setItemSpy.mockRestore()
    }
  })

  it('未ログインで開けるページでは SIGNED_IN のユーザー識別が変わってもリロードしない', async () => {
    const reloadSpy = stubLocation('/login')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())
    await waitFor(() => expect(getClient()!.getQueryData(['currentUser'])).not.toBe(undefined))

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-B'))
    })

    await waitFor(() => {
      expect(getClient()!.getQueryData<{ id: string }>(['currentUser'])?.id).toBe('user-B')
    })
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('保護されたページで TOKEN_REFRESHED によるユーザー識別変化もフルリロードする', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())
    await waitFor(() => expect(getClient()!.getQueryData(['currentUser'])).not.toBe(undefined))

    act(() => {
      authCallback('TOKEN_REFRESHED', sessionFor('user-B'))
    })

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('保護されたページで INITIAL_SESSION によるユーザー識別変化もフルリロードする', async () => {
    const reloadSpy = stubLocation('/org-1/inbox')
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const getClient = renderProvider()
    await waitFor(() => expect(getClient()).not.toBeNull())
    await waitFor(() => expect(getClient()!.getQueryData(['currentUser'])).not.toBe(undefined))

    act(() => {
      authCallback('INITIAL_SESSION', sessionFor('user-B'))
    })

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })
  })
})

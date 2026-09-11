'use client'

import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { Query } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client'
import { get, set, del, keys } from 'idb-keyval'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'
import { clearActiveOrgId } from '@/lib/org/activeOrg'
import { isSignOutInProgress } from '@/lib/auth/signOutClient'
import { isPublicPathMatch } from '@/lib/routes/publicPaths'

const IDB_KEY_PREFIX = 'taskapp-query-cache'

/**
 * Persisted-cache version. When this string changes, PersistQueryClientProvider
 * discards the entire persisted blob on the next load (per user-scoped key) and
 * starts fresh — a one-time cold start, self-healing, no data-correctness impact.
 *
 * ⚠️ 規約（この定数を触るときのルール・厳守）:
 * - **ビルドハッシュにしない**。デプロイ毎に全ユーザーのキャッシュが飛び、永続化の意味が消える。
 *   必ず手動の定数（日付＋理由）にする。
 * - 永続対象クエリの**データ形状**を変えるときの使い分け:
 *   - 単一クエリの形状変更 → その queryKey に版数を入れる（例 `['channelMessages','v2',…]`）。
 *     他クエリのウォームキャッシュを温存できるので**既定はこちら**。
 *   - 複数クエリに波及／影響範囲が不確実 → この buster をバンプして全体を一掃する。
 *
 * 由来: useQuery<ChannelMessageRow[]>（data=配列）→ useInfiniteQuery（data=InfiniteData）へ
 * 変えたのに queryKey を据え置いたため、再訪ユーザーの永続キャッシュ（旧・配列形状）が
 * InfiniteQueryObserver にハイドレートされ `undefined.length` でクラッシュした。複数の併走
 * マージが本番に相乗りしていたため、単一キー版数化ではなく buster 一掃で全パターンを回収する。
 */
export const PERSIST_BUSTER = '2026-07-20-infinite-timeline'

// Legacy key used by a short-lived "single fixed key" design. That design
// caused a cross-tenant data leak: user A closes the tab without signing
// out, user B signs in on the same browser, and `restoreClient` (which ran
// before B's session was known) would hydrate A's persisted tasks/spaces
// into B's query cache — bypassing RLS entirely on the client. Scoped keys
// are the only safe design; this legacy key must be purged, never read.
const LEGACY_UNSCOPED_IDB_KEY = IDB_KEY_PREFIX

/** Build a user-scoped IDB key. Cross-tenant isolation depends on this
 *  scoping — never fall back to an unscoped key. */
function idbKey(userId: string): string {
  return `${IDB_KEY_PREFIX}:${userId}`
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS, // 2 minutes — balance between speed and multi-user freshness
        gcTime: 1000 * 60 * 60 * 24, // 24 hours — keep cache for persistence
        // アプリ全体では無効化しない: ball ownership(誰の番か)の唯一の更新経路である
        // useTasks/useMeetings(realtime/ポーリング無し)がフォーカス再取得に依拠している。
        // 秘書STRUCTUREティアのちらつき対策は per-query の staleTime:5分 で個別に抑制する
        // （QueryProvider.tsx の変更履歴・code review参照。ここをfalseにしない）。
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  })
}

// ['currentUser'] carries PII (email, etc.) and must never be written to
// IDB. It's cheap to re-derive on every load via `restoreClient`'s
// `getSession()` seed below, so persistence buys us nothing for it but adds
// a place PII could linger on disk.
function shouldDehydrateQuery(query: Query): boolean {
  if (query.queryKey[0] === 'currentUser') return false
  // ファイル→表ビューの変換済み表(最大4MBのCSV由来)は IDB に載せない。再取得は安いが
  // 永続化すると IDB が肥大し、他クエリの restore まで遅くなる。
  if (query.queryKey[0] === 'fileTable') return false
  // ファイル一覧の「検索結果」も同じ理由で載せない(['files', spaceId, 版数, 'search', 条件])。
  // 打鍵の切れ目ごとに別キーが生まれ、1件あたり最大500件ぶんの本文を含む。
  // 全件一覧(検索なし)はキャッシュ優先で即描画したいので、そちらは永続する。
  if (query.queryKey[0] === 'files' && query.queryKey[3] === 'search') return false
  // GitHub Issue の紐付け候補検索(useIssueLinkCandidates)も同じ理由で、入力が空でない
  // ものは載せない(['space-github-issue-candidates', repoIds, 検索語])。打鍵の切れ目
  // ごとに別キーが生まれるため。候補の一覧(検索語が空)はキャッシュ優先で載せてよい
  if (query.queryKey[0] === 'space-github-issue-candidates' && query.queryKey[2] !== '') return false
  // 決済の受け付け状況は運用中に切り替わる。IDB に載せると、受け付けを開けた直後の
  // 再読み込みでも古い「準備中」を出し続けてしまう（安いので毎回取り直す）。
  if (query.queryKey[0] === 'stripeStatus') return false
  // GitHub の接続状態(useGitHubConnection)・github_installations の1行(useGitHubInstallation)
  // も同じ理由で載せない。組織の外での操作（別の人が接続/解除）で切り替わるため、
  // 古い「未接続」を出し続けるより毎回取り直すほうが安全（stripeStatus と同じ判断）。
  if (query.queryKey[0] === 'github-connection-status') return false
  if (query.queryKey[0] === 'github-installation') return false
  return defaultShouldDehydrateQuery(query)
}

interface PersisterDeps {
  supabase: ReturnType<typeof createClient>
  queryClient: QueryClient
  currentUserIdRef: React.RefObject<string | null>
}

/**
 * IDB persister scoped to the *current* session's user id.
 *
 * The user id is resolved inside `restoreClient` itself — synchronously
 * from the localStorage-backed session (`getSession()`, no network round
 * trip) — rather than in a separate effect. React flushes child effects
 * before parent effects, so `PersistQueryClientProvider`'s internal restore
 * effect can run before any effect declared in `QueryProvider`; resolving
 * the uid outside `restoreClient` would reintroduce the original
 * restore/persist key-mismatch race.
 *
 * Default-deny: while the uid is unknown (no session), every method is a
 * no-op. We never read or write an unscoped/shared key, which is what
 * caused the cross-tenant leak this design replaces.
 *
 * Write throttling + sticky disable (Fable裁定):
 * react-query calls `persistClient` on every single cache add/remove/update
 * event, with no throttling of its own. Now that project task lists are
 * fetched in full, a single write can be large, so writes to IDB are
 * coalesced to at most once per second — `persistClient` only records the
 * latest snapshot (`pending`) and arms a single 1s timer; the timer's
 * `flush()` is what actually calls `set`. The retained snapshot is a *live*
 * reference to `state.data` for up to 1s, but react-query treats query data
 * as immutable (structural sharing hands back a new object on every change
 * rather than mutating in place), so the referenced snapshot never changes
 * out from under us while it waits to be flushed.
 *
 * `boundUid` is resolved once inside `restoreClient` and then fixed for the
 * lifetime of this persister instance ("uid が文書ごとに固定される" — a
 * document that starts on the login screen has no session, so `boundUid`
 * is `null` and that document never persists; the next user's data is only
 * ever written from the *next* document, loaded fresh after a full
 * navigation post-login). `persistDisabled` is a one-way ratchet: once a
 * user-identity change or sign-out is observed, this persister instance
 * never writes again, even if the same user signs back in — a fresh
 * persister (and a fresh `boundUid`) only comes from a fresh page load.
 */
function makeIdbPersister(
  { supabase, queryClient, currentUserIdRef }: PersisterDeps
): Persister & { disablePersistence(): void; cancelPending(): void } {
  let boundUid: string | null = null
  let persistDisabled = false
  let pending: PersistedClient | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function canPersist(): boolean {
    return (
      !persistDisabled &&
      boundUid !== null &&
      currentUserIdRef.current === boundUid &&
      // signOut() 呼び出し後、通信が失敗するなどして SIGNED_OUT が発火しないまま
      // /login へ遷移する経路がある。その間もここで書かない側に倒しておく
      // （判定を厳しくする方向なので安全 — メイン判断済み）。
      !isSignOutInProgress()
    )
  }

  /** 今 予約されている書き込みだけを取り消す（粘着させない）。timer/pending の
   *  後片付けのみで、`persistDisabled` には触れない。 */
  function cancelPending() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pending = null
  }

  async function flush() {
    timer = null
    const client = pending
    pending = null
    if (!client) return
    // Re-check right before writing — the 1s wait is exactly the window in
    // which sign-out/user-switch can happen.
    if (!canPersist()) return
    const key = idbKey(boundUid!)
    try {
      await set(key, client)
    } catch {
      // IDB write failures (e.g. QuotaExceededError) are best-effort —
      // persistence is a cache warmer, not a source of truth. Swallow so we
      // never produce an unhandled promise rejection from a timer callback.
    }
    // Identity may have changed again while `set` was in flight — we
    // `await`ed `set` above, so that's what actually orders "set, then
    // maybe del" here. The underlying IDB connection's own ordering only
    // matters for the separate case where something else (e.g.
    // clearQueryCache() from a SIGNED_OUT that fired while `set` was still
    // pending) issues its own `del` concurrently with this `set`.
    if (!canPersist()) {
      try {
        await del(key)
      } catch {
        // Best-effort cleanup — nothing else depends on this succeeding,
        // and a timer callback must never produce an unhandled rejection.
      }
    }
  }

  return {
    persistClient: async (client: PersistedClient) => {
      if (!canPersist()) return
      pending = client
      if (timer === null) {
        timer = setTimeout(() => { void flush() }, 1000)
      }
    },
    restoreClient: async () => {
      const { data } = await supabase.auth.getSession()
      const uid = data.session?.user?.id ?? null
      currentUserIdRef.current = uid
      boundUid = uid

      // Seed ['currentUser'] immediately — zero extra wait, and this is the
      // only place currentUser data ever comes from since it's excluded
      // from persistence (see shouldDehydrateQuery above).
      queryClient.setQueryData(['currentUser'], data.session?.user ?? null)

      if (!uid) return undefined
      return await get<PersistedClient>(idbKey(uid))
    },
    removeClient: async () => {
      if (!boundUid) return
      await del(idbKey(boundUid))
    },
    disablePersistence: () => {
      persistDisabled = true
      cancelPending()
    },
    cancelPending,
  }
}

/** Clear all persisted query caches (call on logout / user switch). Matches
 *  both scoped (`taskapp-query-cache:<uid>`) and the legacy unscoped key. */
export async function clearQueryCache() {
  const allKeys = await keys()
  const cacheKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(IDB_KEY_PREFIX)
  )
  await Promise.all(cacheKeys.map((k) => del(k)))
}

const AUTH_RELOAD_GUARD_KEY = 'taskapp:auth-reload-at'
const AUTH_RELOAD_GUARD_WINDOW_MS = 10_000

/**
 * signOutAndLeave() を経由しないログアウト/ユーザー識別変化（例: 他タブでのセッション切れ、
 * 想定外の経路での signOut() 直呼び）を検知したときの最後の砦。ルート常駐のクライアント状態
 * （query cache の観測者・ActiveOrgProvider・cached-auth 等のモジュール変数）は SPA 遷移では
 * 作り直されないため、保護されたページ（未ログインで開けないページ）にいる場合はフルリロード
 * して全て作り直す。
 *
 * - signOutAndLeave() 実行中はここでは何もしない（自身が既にフルページ遷移するため、
 *   二重リロードを防ぐ）。
 * - 未ログインで開けるページ（/login 等）では、そもそも保護されたクライアント状態が
 *   問題にならないのでリロードしない。
 * - 同一イベントの重複発火などで無限リロードに陥らないよう、直近10秒以内に一度リロードして
 *   いれば何もしない（sessionStorage は毎回のフルリロードでは消えないため、次のトリガーに跨って
 *   ガードできる）。
 */
function hardResetIfNeeded(): void {
  if (typeof window === 'undefined') return
  if (isSignOutInProgress()) return
  if (isPublicPathMatch(window.location.pathname)) return

  try {
    const lastReloadAt = window.sessionStorage.getItem(AUTH_RELOAD_GUARD_KEY)
    if (lastReloadAt && Date.now() - Number(lastReloadAt) < AUTH_RELOAD_GUARD_WINDOW_MS) {
      return
    }
    window.sessionStorage.setItem(AUTH_RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // sessionStorage が使えない環境でもリロード自体は続行する（フォールバック優先）
  }

  window.location.reload()
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const [supabase] = useState(createClient)
  const currentUserIdRef = useRef<string | null>(null)
  // currentUserIdRef.current is only read/written inside the persister's async
  // callbacks (persistClient/restoreClient/removeClient), never during render.
  // eslint-disable-next-line react-hooks/refs
  const [persister] = useState(() =>
    makeIdbPersister({ supabase, queryClient, currentUserIdRef })
  )

  // Clear all persisted/in-memory caches (e.g. on logout or user switch)
  const clearAllCaches = useCallback(() => {
    queryClient.clear()
    void clearQueryCache()
  }, [queryClient])

  // One-time migration: purge the legacy unscoped key left behind by the
  // earlier "single fixed key" design, so no stale cross-user data lingers
  // in IDB even if it's never read.
  useEffect(() => {
    void del(LEGACY_UNSCOPED_IDB_KEY)
  }, [])

  // Keep ['currentUser'] in sync with Supabase auth state, and clear caches
  // on logout / user-identity change. This is defense-in-depth on top of
  // the scoped persister above — restoreClient already resolves the uid
  // once at startup; this listener keeps it correct for the rest of the
  // page's lifetime (login/logout/user-switch without a reload).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Always invalidate auth cache on ANY auth state change
      invalidateCachedUser()

      if (event === 'SIGNED_OUT') {
        // Stop the persister first: it must never write another snapshot
        // for the user who just signed out, including anything already
        // debounced and waiting on its 1s timer.
        persister.disablePersistence()
        currentUserIdRef.current = null
        clearAllCaches()
        queryClient.setQueryData(['currentUser'], null)
        // active org の cookie もここで消す。残したままだと、リロード無しで別ユーザーが
        // サインインしたとき、ActiveOrgProvider が「まだ知らないユーザーの初回選択」として
        // 前のユーザーの org id を一度だけ信用してしまう（sign out → 別ユーザーで sign in の
        // フォームレース対策）
        clearActiveOrgId()
        // signOutAndLeave() 経由でないログアウト（他タブでのセッション切れ等）は、ここまでの
        // キャッシュクリアだけでは ActiveOrgProvider 等ルート常駐の状態が作り直されない。
        // 保護されたページにいればフルリロードで確実に作り直す
        hardResetIfNeeded()
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        const newUserId = session?.user?.id ?? null
        const prevUserId = currentUserIdRef.current
        currentUserIdRef.current = newUserId

        // User identity changed — clear stale cache from previous user
        if (prevUserId && newUserId && prevUserId !== newUserId) {
          // Same as SIGNED_OUT: stop the persister before touching caches,
          // so nothing debounced for the previous user can still land.
          persister.disablePersistence()
          clearAllCaches()
          // signOutAndLeave() を経由しない識別変化（例: 別タブでの別ユーザーログイン）も同様に
          // フルリロードで作り直す
          hardResetIfNeeded()
        }

        // setQueryData (not invalidate) to avoid a refetch storm on every
        // auth event — the session payload already has the up-to-date user.
        queryClient.setQueryData(['currentUser'], session?.user ?? null)
      }

      // 二要素認証のコード入力（challengeAndVerify）が成功すると supabase-js が発火する。
      // パスワードログイン直後（aal1）は org_memberships が 42501 で失敗しており、
      // /login/mfa は門番(proxy)の対象外パスなのでリダイレクトも起きない。コード入力を終えて
      // router.replace で元の画面に戻ってもフルリロードではないため ActiveOrgProvider は
      // 再マウントされず、orgsStatus が 'unknown' のまま固定されてしまう
      // （ApiSettings などが「権限を確認中...」を永久に出し続ける）。ここで明示的に取り直す。
      // 通常の SIGNED_IN（タブ再フォーカス等でも発火し得る）では行わない —
      // ユーザー識別の変化は上のキャッシュクリアで既に処理済みで、ここでも取り直すと
      // フォーカスのたびに毎回フェッチが増えてしまう
      if (event === 'MFA_CHALLENGE_VERIFIED') {
        void queryClient.invalidateQueries({ queryKey: ['orgMemberships'] })
      }
    })
    return () => {
      subscription.unsubscribe()
      // Next 16 の開発既定である StrictMode は、この effect を「実行→片付け→
      // 再実行」で一度余分に走らせる。`persister` は useState に保持されたまま
      // 生き延びる（片付けで作り直されない）ため、ここで disablePersistence()
      // （粘着・二度と戻らない）を呼ぶと、開発環境ではこの文書が一度も保存
      // されないまま固定されてしまう。ここでは「今 予約されている書き込み
      // だけ」を取り消す cancelPending() を使う。本当の身元喪失（SIGNED_OUT・
      // uid交代）は上の分岐で disablePersistence() を使う。
      persister.cancelPending()
    }
  }, [supabase, queryClient, clearAllCaches, persister])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        buster: PERSIST_BUSTER, // bump to discard stale-shape persisted caches (see constant above)
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

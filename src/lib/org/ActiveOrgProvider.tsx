'use client'

import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { needsMfaChallenge, isMfaExemptPath, MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { getActiveOrgId, setActiveOrgId } from './activeOrg'
import type { SupabaseClient } from '@supabase/supabase-js'

interface OrgEntry {
  orgId: string
  orgName: string
  role: string
}

/**
 * 所属組織一覧（orgs）の確からしさ。
 * - 'unknown': まだ一度も取れていない（キャッシュも無い）。true=未確定の間は誤判定を避けて false 側に倒す
 * - 'cached': IDB の永続キャッシュから復元されただけで、今回のネットワーク確認はまだ済んでいない
 * - 'verified': 今回のページ読み込み以降にネットワークから取り直し、確認が取れた
 */
export type OrgsStatus = 'unknown' | 'cached' | 'verified'

export interface ActiveOrgContextValue {
  activeOrgId: string | null
  activeOrgName: string | null
  activeOrgRole: string | null
  orgs: OrgEntry[]
  orgsStatus: OrgsStatus
  switchOrg: (orgId: string) => void
  loading: boolean
}

const defaultValue: ActiveOrgContextValue = {
  activeOrgId: null,
  activeOrgName: null,
  activeOrgRole: null,
  orgs: [],
  orgsStatus: 'unknown',
  switchOrg: () => {},
  loading: true,
}

export const ActiveOrgContext = createContext<ActiveOrgContextValue>(defaultValue)

// switchOrg の useCallback 依存を安定させるための共有の空配列（orgs 未取得時の既定値）
const EMPTY_ORGS: OrgEntry[] = []

/**
 * このページ読み込みが始まった時刻。IDB の永続キャッシュ（＝このページ読み込みより前に
 * 書かれたデータ）と、今回のマウント以降にネットワークから取れたデータを区別するための基準線。
 * モジュール読み込み時に1回だけ評価する（render中に評価しない・render-pure な定数）。
 */
export const PAGE_LOADED_AT = typeof window !== 'undefined' ? Date.now() : 0

/** 二要素認証の未入力で DB に拒否された（PostgREST 403 / 42501）か */
function isMfaDenied(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  // supabase-js の PostgrestError は code/message のみ（status は無い）
  return err.code === '42501' || (err.message ?? '').includes('mfa_required')
}

let redirectingToMfa = false

/**
 * 古い aal1 セッション（別端末で登録した後など）を更新し、コード入力が要るなら /login/mfa へ。回したら true。
 * コード入力画面自身では絶対に発火させない（無限リロードになる）。1回だけ
 */
async function redirectToMfaIfStale(supabase: SupabaseClient): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (redirectingToMfa || isMfaExemptPath(window.location.pathname)) return false
  try {
    await supabase.auth.refreshSession()
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (needsMfaChallenge(aal?.currentLevel, aal?.nextLevel)) {
      redirectingToMfa = true
      const back = window.location.pathname + window.location.search
      window.location.assign(`${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent(back)}`)
      return true
    }
  } catch {
    /* 判定できなければ従来どおり空表示 */
  }
  return false
}

/** ['orgMemberships', userId] の queryFn。react-query に乗せることで IDB 永続キャッシュの対象になる */
async function fetchOrgMemberships(supabase: SupabaseClient, userId: string): Promise<OrgEntry[]> {
  try {
    const { data: memberships, error: memErr } = await supabase
      .from('org_memberships')
      .select('org_id, role, created_at, organizations(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (memErr) {
      // 別端末で二要素認証を登録した後の古いセッション（cookie の factor 情報が古く門番を素通り）だと、
      // DB が 403(42501) を返す。そのときだけセッションを更新して判定し直し、必要ならコード入力へ回す
      // （通常の「組織 0 件」では何もしない）。リダイレクトした場合も、呼び出し元には必ずエラーとして返す
      if (isMfaDenied(memErr)) {
        await redirectToMfaIfStale(supabase)
      }
      throw memErr
    }

    if (!memberships || memberships.length === 0) return []

    return memberships.map((m: {
      org_id: string
      role: string
      organizations: { name: string }[] | { name: string } | null
    }) => {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations
      return {
        orgId: m.org_id,
        orgName: org?.name ?? '未設定',
        role: m.role,
      }
    })
  } catch (err) {
    console.error('Failed to fetch organizations:', err)
    throw err
  }
}

export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useCurrentUser()
  const currentUserId = userLoading ? undefined : (user?.id ?? null)

  // Read cookie synchronously on mount for instant initial render.
  // Lazy useState initializer (not useRef.current) so the value is computed once without
  // reading a ref during render (react-hooks/refs).
  const [cookieOrgId] = useState<string | null>(() => getActiveOrgId())

  // ユーザー操作（switchOrg）または初回の cookie 復元で決まる「生の」選択値。
  // どのユーザーの選択かを uid ごと保持する（sign out → 別ユーザーで sign in を、リロード無しで
  // やった場合に前のユーザーの選択が一瞬でも次のユーザーに漏れないようにするため）。
  const [selection, setSelection] = useState<{ uid: string | null; orgId: string } | null>(null)
  // 直前に見たユーザーID。undefined = まだ一度もユーザー確定を観測していない
  const [lastSeenUserId, setLastSeenUserId] = useState<string | null | undefined>(undefined)

  // ユーザーIDの変化を検知して selection を補正する。
  // 「前回レンダーの情報を保存し、変化を検知したら render 中に setState で補正する」という
  // React公式パターン（useEffectを使わない）。setState は呼ぶが、guard (currentUserId !== lastSeenUserId)
  // があるので無限ループにはならず、コミットされる最終レンダーは補正後の値で描画される。
  if (currentUserId !== undefined && currentUserId !== lastSeenUserId) {
    const isFirstResolution = lastSeenUserId === undefined
    setLastSeenUserId(currentUserId)
    if (isFirstResolution) {
      // 初回だけ: cookie の値を、いま分かった最初のユーザーに紐付ける
      if (cookieOrgId && currentUserId) {
        setSelection({ uid: currentUserId, orgId: cookieOrgId })
      }
    } else if (selection && selection.uid !== currentUserId) {
      // ユーザーが変わった（サインアウト→別ユーザーでサインイン、リロード無し）。
      // 前ユーザーの選択は次のユーザーに持ち越さない
      setSelection(null)
    }
  }

  // 表示に使う「生の」選択値。いま分かっているユーザーに紐付いているときだけ有効（上の補正が
  // 反映される前の中間レンダーでも安全なように、ここでも uid の一致を確認する）
  const rawActiveOrgId = selection && selection.uid === currentUserId ? selection.orgId : null

  // 同じ理由でクライアントもレイジーな useState で1回だけ作る（SSR では window が無いので null のまま）
  const [supabase] = useState<ReturnType<typeof createClient> | null>(() =>
    typeof window !== 'undefined' ? createClient() : null
  )

  const { data, dataUpdatedAt, isPending } = useQuery<OrgEntry[]>({
    queryKey: ['orgMemberships', user?.id],
    queryFn: () => fetchOrgMemberships(supabase as SupabaseClient, user!.id),
    enabled: !!user?.id,
    // 「このページ読み込みより前に書かれたデータ（IDB永続キャッシュ由来）」は常に stale = 0 扱いにして
    // マウント時に必ず1回取り直す。それ以外（今回のマウント以降に取れたデータ）はアプリ既定の2分。
    // refetchOnMount:'always' は使わない: IDB復元は「uidがまだ undefined → 復元後に判明」という
    // 順序で queryKey が切り替わるため、'always' のタイミングを素通りしてしまう
    // （常に有効な enabled:true で新規マウントされるのと同じ扱いになり、結局は refetchOnMount の
    // 既定値=true と staleTime の組み合わせで判定する必要がある）。
    staleTime: (q) => (q.state.dataUpdatedAt < PAGE_LOADED_AT ? 0 : 2 * 60_000),
    // 一時的な失敗は1回だけ再試行する。42501（二要素認証未入力によるDB拒否）は状況が変わらない限り
    // 再試行しても同じ結果になるだけなので試行しない（redirectToMfaIfStale を二重に走らせないためでもある）
    retry: (failureCount, error) =>
      !isMfaDenied(error as { code?: string; message?: string } | null | undefined) && failureCount < 1,
  })

  const orgs = data ?? EMPTY_ORGS

  // 'verified' の判定は「今回のページ読み込み以降に取れたデータか」(dataUpdatedAt) で行う。
  // status（'success'/'error'）や isFetchedAfterMount では判定しない:
  // - uidがマウント後に判明するケースでは isFetchedAfterMount が hydrate だけで true になり得る
  // - 一度 verified になった後の再取得が失敗すると status は 'error' になるが、data(前回成功分)は
  //   そのまま残るので、引き続き 'verified' として扱ってよい（cached に後退させない）
  const orgsStatus: OrgsStatus =
    data === undefined ? 'unknown' : dataUpdatedAt >= PAGE_LOADED_AT ? 'verified' : 'cached'

  // loading の意味は従来どおり据え置く（通知・/my・お知らせが !orgLoading を起点に取得を始めるため）。
  // cookie に org id が残っていれば即座に false（cookie 由来で先に activeOrgId を出せるため）。
  // cookie が無いときだけ、ユーザー確定 → 所属一覧の初回取得完了 を待つ
  const loading = cookieOrgId ? false : userLoading || (!!user && isPending)

  // 表示用の activeOrgId は render 中に導出する（effect + setState を使わない）。
  // - ユーザーが確定していて所属を持たない（未ログイン等）ときは null
  // - 所属一覧がネットワークで確認済み(verified)なら:
  //   - 所属が0件なら null（cookie の値をいつまでも出し続けない。古い契約解除・削除後の掃除）
  //   - 1件以上あれば、rawActiveOrgId が実在の所属かを突き合わせ、無効/未所持なら先頭の org
  //     にフォールバックする（cookie 自体の書き換えは下の effect で）
  // - それ以外（unknown/cached）はユーザーの選択・cookie 由来の値を優先しつつ、無ければ
  //   キャッシュの先頭 org を仮のスコープとして使う（cookie が無い＝Safari ITP 等でJS発行cookieが
  //   失効した状態でも、確認済み一覧が来るまで無所属＝通知/マイタスクが空回りするのを防ぐ）
  let activeOrgId: string | null
  if (!userLoading && !user) {
    activeOrgId = null
  } else if (orgsStatus === 'verified') {
    if (orgs.length === 0) {
      activeOrgId = null
    } else {
      const validCookie = rawActiveOrgId && orgs.some((o) => o.orgId === rawActiveOrgId)
      activeOrgId = validCookie ? rawActiveOrgId : orgs[0].orgId
    }
  } else {
    activeOrgId = rawActiveOrgId ?? orgs[0]?.orgId ?? null
  }

  // cookie の書き換えは document.cookie という外部システムへの副作用なので effect に残す。
  // ローカル state はいじらない（上の導出だけで画面には既に正しい値が出ているため）。
  // ネットワークで確認が取れた(verified)後だけ行う: 復元しただけ(cached)の古い一覧で書き換えると、
  // 実は今も所属している組織を誤って弾く恐れがある
  useEffect(() => {
    if (orgsStatus !== 'verified' || orgs.length === 0) return
    const validCookie = rawActiveOrgId && orgs.some((o) => o.orgId === rawActiveOrgId)
    if (validCookie) return
    setActiveOrgId(orgs[0].orgId)
  }, [orgsStatus, orgs, rawActiveOrgId])

  const switchOrg = useCallback((orgId: string) => {
    const target = orgs.find(o => o.orgId === orgId)
    if (!target) return
    setSelection({ uid: currentUserId ?? null, orgId })
    setActiveOrgId(orgId)
  }, [orgs, currentUserId])

  const activeOrg = orgs.find(o => o.orgId === activeOrgId)
  const activeOrgName = activeOrg?.orgName ?? null
  const activeOrgRole = activeOrg?.role ?? null

  // 呼び出し側の無駄な再描画を避けるため、実際に意味が変わった時だけ新しいオブジェクトを作る
  // （orgs は react-query の構造共有で内容が同じなら参照も同じになる）
  const value = useMemo<ActiveOrgContextValue>(() => ({
    activeOrgId,
    activeOrgName,
    activeOrgRole,
    orgs,
    orgsStatus,
    switchOrg,
    loading,
  }), [activeOrgId, activeOrgName, activeOrgRole, orgs, orgsStatus, switchOrg, loading])

  return (
    <ActiveOrgContext.Provider value={value}>
      {children}
    </ActiveOrgContext.Provider>
  )
}

/**
 * ログインの状態（セッション・2段階認証の段階・いま見ている組織）をアプリ全体に配る。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchMyOrgs, type OrgChoice } from '~/api/orgs'
import { unregisterLeftoverPushToken, unregisterStoredPushToken } from '~/api/pushTokens'
import { supabase } from '~/api/supabase'
import { assuranceFromSession, resolveAuthStep, type AuthStep } from '~/lib/authStep'
import { clearCachedData } from './queryClient'

const ACTIVE_ORG_KEY = 'agentpm-active-org'

interface SessionState {
  step: AuthStep
  session: Session | null
  userId: string | null
  orgs: OrgChoice[]
  activeOrg: OrgChoice | null
  /** 組織を読み込み中（読み終わるまで一覧を出さない。別の組織のデータが混ざるのを防ぐ） */
  orgsLoading: boolean
  orgsError: string | null
  refetchOrgs: () => void
  setActiveOrg: (orgId: string) => void
  /** 2段階認証を通したあとに呼ぶ（新しいトークンを読み直す） */
  refreshAuthLevel: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

/** 前の人のデータを端末から消す（自分でログアウトしたときも、トークン失効などで切れたときも） */
async function clearLocalUserData(): Promise<void> {
  await clearCachedData()
  await AsyncStorage.removeItem(ACTIVE_ORG_KEY).catch(() => {})
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [savedOrgId, setSavedOrgId] = useState<string | null | undefined>(undefined)
  const [chosenOrgId, setChosenOrgId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
        // ログインしていない起動: 前に外し損ねた通知の宛先が残っていれば、ここでやり直す
        if (!data.session) void unregisterLeftoverPushToken()
      })
      // 保存先が読めない等で失敗しても、起動画面で止めずにログイン画面へ進める
      .catch(() => setSession(null))
      .finally(() => setSessionLoaded(true))
    AsyncStorage.getItem(ACTIVE_ORG_KEY)
      .catch(() => null)
      .then((saved) => setSavedOrgId(saved))
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'SIGNED_OUT') {
        setChosenOrgId(null)
        setSavedOrgId(null)
        void clearLocalUserData()
        void unregisterLeftoverPushToken()
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  // 通信せずトークンから求める（トークン更新のたびに「確かめ中」へ戻して画面を閉じないため）
  const aal = useMemo(() => (session ? assuranceFromSession(session) : null), [session])
  const step: AuthStep = sessionLoaded ? resolveAuthStep({ hasSession: !!session, aal }) : 'checking'

  const refreshAuthLevel = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
  }, [])

  // 2段階目まで通ってから組織を読む（それまでは RLS が拒否する）。前回の結果は端末に取り置かれる
  const orgsQuery = useQuery({
    queryKey: ['orgs', userId],
    queryFn: () => fetchMyOrgs(userId!),
    enabled: step === 'ready' && !!userId,
  })
  const orgs = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data])
  const { refetch: refetchOrgsQuery } = orgsQuery
  const refetchOrgs = useCallback(() => {
    void refetchOrgsQuery()
  }, [refetchOrgsQuery])

  // 選んだ組織がまだ所属先にあればそれ、なければ前回の組織、それも無ければ最初の組織（Web と同じ決め方）
  const activeOrg =
    orgs.find((o) => o.orgId === chosenOrgId) ?? orgs.find((o) => o.orgId === savedOrgId) ?? orgs[0] ?? null

  const setActiveOrg = useCallback((orgId: string) => {
    setChosenOrgId(orgId)
    AsyncStorage.setItem(ACTIVE_ORG_KEY, orgId).catch(() => {})
  }, [])

  const signOut = useCallback(async () => {
    // サーバーへの失効の連絡が通信エラーで失敗すると、supabase-js は端末のセッションを消さない。
    // そのときも端末からは必ず消す（共用端末で「ログアウトしたつもり」を防ぐ）
    // 先にこの端末を通知の宛先から外す（ログアウトした後は自分の行を消せない）
    await unregisterStoredPushToken()
    const { error } = await supabase.auth.signOut()
    if (error) await supabase.auth.signOut({ scope: 'local' })
    // SIGNED_OUT でも消すが、イベントを待たずに消しておく
    await clearLocalUserData()
  }, [])

  const value = useMemo<SessionState>(
    () => ({
      step,
      session,
      userId,
      orgs,
      // 前回の組織を読み終わるまで決めない（一瞬だけ別の組織のデータを出さない）
      activeOrg: savedOrgId === undefined ? null : activeOrg,
      orgsLoading: orgsQuery.isPending || savedOrgId === undefined,
      orgsError: orgsQuery.isError && !orgsQuery.data ? '組織を読み込めませんでした' : null,
      refetchOrgs,
      setActiveOrg,
      refreshAuthLevel,
      signOut,
    }),
    [step, session, userId, orgs, activeOrg, savedOrgId, orgsQuery.isPending, orgsQuery.isError, orgsQuery.data, refetchOrgs, setActiveOrg, refreshAuthLevel, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession は SessionProvider の中で使う')
  return ctx
}

/** ログイン済み・組織が決まっている画面で使う（決まっていなければ null） */
export function useReadyContext(): { userId: string; orgId: string } | null {
  const { userId, activeOrg } = useSession()
  return userId && activeOrg ? { userId, orgId: activeOrg.orgId } : null
}

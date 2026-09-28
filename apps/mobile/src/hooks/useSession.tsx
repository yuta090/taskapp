/**
 * ログインの状態（セッション・2段階認証の段階・いま見ている組織）をアプリ全体に配る。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchMyOrgs, type OrgChoice } from '~/api/orgs'
import { supabase } from '~/api/supabase'
import { resolveAuthStep, type AssuranceLevel, type AuthStep } from '~/lib/authStep'
import { AAL_QUERY_KEY, clearCachedData } from './queryClient'

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
  setActiveOrg: (orgId: string) => void
  refreshAuthLevel: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [savedOrgId, setSavedOrgId] = useState<string | null | undefined>(undefined)
  const [chosenOrgId, setChosenOrgId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    AsyncStorage.getItem(ACTIVE_ORG_KEY)
      .catch(() => null)
      .then((saved) => setSavedOrgId(saved))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  const accessToken = session?.access_token ?? null

  // 2段階認証をどこまで通したか。キーにトークンを入れる（ログインし直し・更新したら確かめ直す）。
  // トークンを含むので、端末への取り置きからは外している（hooks/queryClient.ts の shouldPersistQuery）
  const aalQuery = useQuery({
    queryKey: [AAL_QUERY_KEY, accessToken],
    queryFn: async (): Promise<AssuranceLevel> => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) throw error
      return { currentLevel: data.currentLevel, nextLevel: data.nextLevel }
    },
    enabled: !!accessToken,
    staleTime: Infinity,
  })
  const aal = aalQuery.data ?? null
  const refreshAuthLevel = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [AAL_QUERY_KEY] })
  }, [queryClient])

  const step: AuthStep = sessionLoaded ? resolveAuthStep({ hasSession: !!session, aal }) : 'checking'

  // 2段階目まで通ってから組織を読む（それまでは RLS が拒否する）。前回の結果は端末に取り置かれる
  const orgsQuery = useQuery({
    queryKey: ['orgs', userId],
    queryFn: () => fetchMyOrgs(userId!),
    enabled: step === 'ready' && !!userId,
  })
  const orgs = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data])

  // 選んだ組織がまだ所属先にあればそれ、なければ前回の組織、それも無ければ最初の組織（Web と同じ決め方）
  const activeOrg =
    orgs.find((o) => o.orgId === chosenOrgId) ?? orgs.find((o) => o.orgId === savedOrgId) ?? orgs[0] ?? null

  const setActiveOrg = useCallback((orgId: string) => {
    setChosenOrgId(orgId)
    AsyncStorage.setItem(ACTIVE_ORG_KEY, orgId).catch(() => {})
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    await clearCachedData()
    await AsyncStorage.removeItem(ACTIVE_ORG_KEY).catch(() => {})
    setChosenOrgId(null)
    setSavedOrgId(null)
    queryClient.removeQueries({ queryKey: ['orgs'] })
  }, [queryClient])

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
      setActiveOrg,
      refreshAuthLevel,
      signOut,
    }),
    [step, session, userId, orgs, activeOrg, savedOrgId, orgsQuery.isPending, orgsQuery.isError, orgsQuery.data, setActiveOrg, refreshAuthLevel, signOut]
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

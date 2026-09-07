'use client'

import { createContext, useState, useEffect, useCallback, useRef } from 'react'
import { needsMfaChallenge, MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { getActiveOrgId, setActiveOrgId } from './activeOrg'
import type { SupabaseClient } from '@supabase/supabase-js'

interface OrgEntry {
  orgId: string
  orgName: string
  role: string
}

export interface ActiveOrgContextValue {
  activeOrgId: string | null
  activeOrgName: string | null
  activeOrgRole: string | null
  orgs: OrgEntry[]
  switchOrg: (orgId: string) => void
  loading: boolean
}

const defaultValue: ActiveOrgContextValue = {
  activeOrgId: null,
  activeOrgName: null,
  activeOrgRole: null,
  orgs: [],
  switchOrg: () => {},
  loading: true,
}

export const ActiveOrgContext = createContext<ActiveOrgContextValue>(defaultValue)

/** 古い aal1 セッションを更新し、コード入力が要るなら /login/mfa へ。回したら true */
async function redirectToMfaIfStale(supabase: SupabaseClient): Promise<boolean> {
  try {
    await supabase.auth.refreshSession()
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (needsMfaChallenge(aal?.currentLevel, aal?.nextLevel)) {
      const back = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
      window.location.assign(`${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent(back)}`)
      return true
    }
  } catch {
    /* 判定できなければ従来どおり空表示 */
  }
  return false
}

export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useCurrentUser()
  const [orgs, setOrgs] = useState<OrgEntry[]>([])

  // Read cookie synchronously on mount for instant initial render
  const cookieOrgId = useRef(getActiveOrgId()).current
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(cookieOrgId)
  // If cookie has a cached orgId, children can render immediately without waiting
  const [loading, setLoading] = useState(!cookieOrgId)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (typeof window !== 'undefined' && supabaseRef.current == null) {
    supabaseRef.current = createClient()
  }

  // Fetch orgs and verify membership in background
  useEffect(() => {
    if (userLoading) return
    if (!user) {
      setOrgs([])
      setActiveOrgIdState(null)
      setLoading(false)
      return
    }
    const supabase = supabaseRef.current
    if (!supabase) return

    const fetchOrgs = async () => {
      try {
        const { data: memberships, error: memErr } = await (supabase as SupabaseClient)
          .from('org_memberships')
          .select('org_id, role, created_at, organizations(name)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })

        if (memErr || !memberships || memberships.length === 0) {
          // 別端末で二要素認証を登録した後の古いセッション（cookie の factor 情報が古く門番を素通り）だと、
          // RLS で全部 0 件になり「データが消えた」ように見える。セッションを更新して判定し直し、必要ならコード入力へ
          if (await redirectToMfaIfStale(supabase as SupabaseClient)) return
          setOrgs([])
          setActiveOrgIdState(null)
          setLoading(false)
          return
        }

        const orgList: OrgEntry[] = memberships.map((m: {
          org_id: string
          role: string
          organizations: { name: string }[] | { name: string } | null
        }) => {
          const org = Array.isArray(m.organizations)
            ? m.organizations[0]
            : m.organizations
          return {
            orgId: m.org_id,
            orgName: org?.name ?? '未設定',
            role: m.role,
          }
        })

        setOrgs(orgList)

        // Validate cookie value against actual membership
        const currentOrgId = cookieOrgId
        const validCookie = currentOrgId && orgList.some(o => o.orgId === currentOrgId)

        if (validCookie) {
          // Cookie org is valid — keep the already-set activeOrgId
          setActiveOrgIdState(currentOrgId)
        } else {
          // Cookie was stale or missing — fall back to first org
          const firstOrg = orgList[0]
          setActiveOrgIdState(firstOrg.orgId)
          setActiveOrgId(firstOrg.orgId)
        }
      } catch (err: unknown) {
        console.error('Failed to fetch organizations:', err)
      } finally {
        setLoading(false)
      }
    }

    void fetchOrgs()
  }, [user, userLoading, cookieOrgId])

  const switchOrg = useCallback((orgId: string) => {
    const target = orgs.find(o => o.orgId === orgId)
    if (!target) return
    setActiveOrgIdState(orgId)
    setActiveOrgId(orgId)
  }, [orgs])

  const activeOrg = orgs.find(o => o.orgId === activeOrgId)

  const value: ActiveOrgContextValue = {
    activeOrgId,
    activeOrgName: activeOrg?.orgName ?? null,
    activeOrgRole: activeOrg?.role ?? null,
    orgs,
    switchOrg,
    loading,
  }

  return (
    <ActiveOrgContext.Provider value={value}>
      {children}
    </ActiveOrgContext.Provider>
  )
}

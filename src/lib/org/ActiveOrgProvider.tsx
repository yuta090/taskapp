'use client'

import { createContext, useState, useEffect, useCallback, useRef } from 'react'
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

export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useCurrentUser()
  const [orgs, setOrgs] = useState<OrgEntry[]>([])
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // Fetch all orgs user belongs to
  useEffect(() => {
    if (userLoading) return
    if (!user) {
      setOrgs([])
      setActiveOrgIdState(null)
      setLoading(false)
      return
    }

    const fetchOrgs = async () => {
      try {
        const { data: memberships, error: memErr } = await (supabase as SupabaseClient)
          .from('org_memberships')
          .select('org_id, role, created_at, organizations(name)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })

        if (memErr || !memberships || memberships.length === 0) {
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

        // Determine active org
        const cookieOrgId = getActiveOrgId()
        const validCookie = cookieOrgId && orgList.some(o => o.orgId === cookieOrgId)

        if (validCookie) {
          setActiveOrgIdState(cookieOrgId)
        } else {
          // Default to first org
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
  }, [user, userLoading, supabase])

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

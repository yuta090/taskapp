'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

export interface CurrentOrgState {
  orgId: string | null
  orgName: string | null
  role: string | null
  loading: boolean
  error: string | null
}

export function useCurrentOrg(): CurrentOrgState {
  const { user } = useCurrentUser()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    const fetchOrg = async () => {
      try {
        // Step 1: Get membership
        const { data: membership, error: memErr } = await (supabase as SupabaseClient)
          .from('org_memberships')
          .select('org_id, role')
          .eq('user_id', user.id)
          .limit(1)
          .single()

        if (memErr || !membership) {
          setLoading(false)
          return
        }

        setOrgId(membership.org_id)
        setRole(membership.role)

        // Step 2: Get organization name
        const { data: org, error: orgErr } = await (supabase as SupabaseClient)
          .from('organizations')
          .select('name')
          .eq('id', membership.org_id)
          .single()

        if (orgErr || !org) {
          setLoading(false)
          return
        }

        setOrgName(org.name)
      } catch (err: unknown) {
        console.error('Failed to fetch org:', err)
        setError(err instanceof Error ? err.message : '組織情報の取得に失敗しました')
      } finally {
        setLoading(false)
      }
    }

    void fetchOrg()
  }, [user, supabase])

  return { orgId, orgName, role, loading, error }
}

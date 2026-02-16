'use client'

import { useContext } from 'react'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

export interface CurrentOrgState {
  orgId: string | null
  orgName: string | null
  role: string | null
  loading: boolean
  error: null
}

export function useCurrentOrg(): CurrentOrgState {
  const ctx = useContext(ActiveOrgContext)
  return {
    orgId: ctx.activeOrgId,
    orgName: ctx.activeOrgName,
    role: ctx.activeOrgRole,
    loading: ctx.loading,
    error: null,
  }
}

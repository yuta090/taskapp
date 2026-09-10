'use client'

import { useContext } from 'react'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

export interface CurrentOrgState {
  orgId: string | null
  orgName: string | null
  role: string | null
  loading: boolean
  /** 所属組織一覧の確からしさ（'unknown'=未確定 / 'cached'=永続キャッシュ由来 / 'verified'=ネットワークで確認済み） */
  orgsStatus: ActiveOrgContextValue['orgsStatus']
  error: null
}

export function useCurrentOrg(): CurrentOrgState {
  const ctx = useContext(ActiveOrgContext)
  return {
    orgId: ctx.activeOrgId,
    orgName: ctx.activeOrgName,
    role: ctx.activeOrgRole,
    loading: ctx.loading,
    orgsStatus: ctx.orgsStatus,
    error: null,
  }
}

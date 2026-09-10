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
  /** verified のまま、直近の裏取り直しだけが失敗しているか（強い判定には使わないこと） */
  orgsRefreshFailed: boolean
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
    orgsRefreshFailed: ctx.orgsRefreshFailed,
    error: null,
  }
}

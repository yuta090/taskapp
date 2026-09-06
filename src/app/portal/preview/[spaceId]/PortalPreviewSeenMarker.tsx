'use client'

import { useEffect } from 'react'
import { markPortalPreviewSeen } from '@/lib/portal/markPortalPreviewSeen'
import { recordOrgMilestone } from '@/lib/analytics/recordOrgMilestone'

/**
 * Invisible — fires the one-time portal_preview_seen flag write on mount.
 * 運営の分析用に、組織の節目「相手先の画面をプレビュー」も同時に記録する
 * （プレビュー閲覧は元データに時刻が残らないため、ここでだけ直接記録する）。
 */
export function PortalPreviewSeenMarker({ orgId }: { orgId?: string }) {
  useEffect(() => {
    void markPortalPreviewSeen()
    if (orgId) void recordOrgMilestone(orgId, 'portal_previewed')
  }, [orgId])
  return null
}

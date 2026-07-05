'use client'

import { useEffect } from 'react'
import { markPortalPreviewSeen } from '@/lib/portal/markPortalPreviewSeen'

/** Invisible — fires the one-time portal_preview_seen flag write on mount. */
export function PortalPreviewSeenMarker() {
  useEffect(() => {
    void markPortalPreviewSeen()
  }, [])
  return null
}

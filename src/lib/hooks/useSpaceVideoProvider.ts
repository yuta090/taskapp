'use client'

import { useMemo } from 'react'
import { useSpaceRow } from './useSpaceRow'

type VideoProvider = 'google_meet' | 'zoom' | 'teams'

interface UseSpaceVideoProviderReturn {
  defaultProvider: VideoProvider | null
  availableProviders: VideoProvider[]
  loading: boolean
}

/**
 * 会議ツールの既定。値はプロジェクト1行（useSpaceRow）から読む。
 */
export function useSpaceVideoProvider(spaceId: string | null): UseSpaceVideoProviderReturn {
  const { space, isPending } = useSpaceRow(spaceId)

  // Build available providers based on environment variables
  const availableProviders = useMemo(() => {
    const providers: VideoProvider[] = []

    // Google Meet is always available (depends on Google Calendar connection, handled at usage site)
    providers.push('google_meet')

    if (process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true') {
      providers.push('zoom')
    }
    if (process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true') {
      providers.push('teams')
    }

    return providers
  }, [])

  return {
    defaultProvider: (space?.default_video_provider as VideoProvider | null) ?? null,
    availableProviders,
    loading: !!spaceId && isPending,
  }
}

'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

type VideoProvider = 'google_meet' | 'zoom' | 'teams'

interface UseSpaceVideoProviderReturn {
  defaultProvider: VideoProvider | null
  availableProviders: VideoProvider[]
  loading: boolean
}

export function useSpaceVideoProvider(spaceId: string | null): UseSpaceVideoProviderReturn {
  const [defaultProvider, setDefaultProvider] = useState<VideoProvider | null>(null)
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!spaceId) {
      setDefaultProvider(null)
      return
    }

    let cancelled = false
    setLoading(true)

    const fetch = async () => {
      try {
        const { data } = await (supabase as SupabaseClient)
          .from('spaces')
          .select('default_video_provider')
          .eq('id', spaceId)
          .single()

        if (!cancelled && data?.default_video_provider) {
          setDefaultProvider(data.default_video_provider as VideoProvider)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetch()
    return () => { cancelled = true }
  }, [spaceId, supabase])

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
    defaultProvider,
    availableProviders,
    loading,
  }
}

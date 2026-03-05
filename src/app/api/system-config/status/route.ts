import { NextResponse } from 'next/server'
import { getAllIntegrationStatus } from '@/lib/integrations/system-config'

export const runtime = 'nodejs'

/**
 * GET /api/system-config/status
 * Returns enabled/disabled status for each integration provider.
 * Public (authenticated users) — no credentials exposed.
 */
export async function GET() {
  try {
    const status = await getAllIntegrationStatus()
    return NextResponse.json(status)
  } catch (err) {
    console.error('Failed to fetch integration status:', err)
    // Fallback to env vars if DB is unavailable
    return NextResponse.json({
      github: process.env.NEXT_PUBLIC_GITHUB_ENABLED === 'true',
      slack: process.env.NEXT_PUBLIC_SLACK_ENABLED === 'true',
      google_calendar: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED === 'true',
      zoom: process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true',
      teams: process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true',
    })
  }
}

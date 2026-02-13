import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar/config'
import { getValidToken } from '@/lib/integrations'
import { queryFreeBusy } from '@/lib/google-calendar'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import type { IntegrationConnection } from '@/lib/integrations/types'

export const runtime = 'nodejs'

let _supabaseAdmin: ReturnType<typeof createSupabaseClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * POST /api/integrations/freebusy
 *
 * Queries Google Calendar Free/Busy API for specified users.
 * Returns busy periods for each user who has an active Google Calendar connection.
 *
 * Request body:
 *   { userIds: string[], timeMin: string, timeMax: string }
 *
 * Response:
 *   { calendars: { [userId]: { busy: { start, end }[] } } }
 */
export async function POST(request: NextRequest) {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json(
      { error: 'Google Calendar integration is not enabled' },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { userIds: string[]; timeMin: string; timeMax: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userIds, timeMin, timeMax } = body

  if (
    !Array.isArray(userIds) ||
    userIds.length === 0 ||
    !timeMin ||
    !timeMax
  ) {
    return NextResponse.json(
      { error: 'userIds, timeMin, and timeMax are required' },
      { status: 400 }
    )
  }

  // Limit to prevent abuse
  if (userIds.length > 20) {
    return NextResponse.json(
      { error: 'Maximum 20 users per request' },
      { status: 400 }
    )
  }

  // Batch fetch all active google_calendar connections for the requested users
  const { data: connections } = await (getSupabaseAdmin() as any)
    .from('integration_connections')
    .select('*')
    .eq('provider', 'google_calendar')
    .eq('owner_type', 'user')
    .in('owner_id', userIds)
    .eq('status', 'active')

  const connectionsByUser = new Map<string, IntegrationConnection>()
  for (const conn of (connections ?? []) as IntegrationConnection[]) {
    connectionsByUser.set(conn.owner_id, conn)
  }

  const calendars: Record<string, { busy: { start: string; end: string }[] }> = {}

  // Query Free/Busy for each user with an active connection (in parallel)
  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      const connection = connectionsByUser.get(userId)
      if (!connection) return

      const accessToken = await getValidToken(
        connection.id,
        async (refreshToken) => {
          const result = await refreshAccessToken(refreshToken)
          return {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken ?? null,
            expiresAt: result.expiresAt,
          }
        }
      )

      if (!accessToken) return

      const result = await queryFreeBusy(accessToken, {
        timeMin,
        timeMax,
        calendarIds: ['primary'],
      })

      const primaryCalendar = result.calendars?.['primary']
      if (primaryCalendar) {
        calendars[userId] = { busy: primaryCalendar.busy }
      }
    })
  )

  // Log any failures without failing the entire request
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[FreeBusy] Error:', result.reason)
    }
  }

  return NextResponse.json({ calendars })
}

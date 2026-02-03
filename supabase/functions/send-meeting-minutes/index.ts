// send-meeting-minutes Edge Function
// AT-011: Send meeting end notifications via email + in_app
// Triggered when a meeting ends

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Types
interface MeetingMinutesRequest {
  meeting_id: string
}

interface Recipient {
  user_id: string
  email: string
  side: 'client' | 'internal'
  display_name: string | null
}

// Note: NotificationPayload type removed - payload structure is inline in code

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate Authorization header (service-role key or valid JWT)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Track if this is a trusted service-role call or user-initiated
    let isServiceRoleCall = false
    let authenticatedUserId: string | null = null

    if (token === supabaseServiceKey) {
      // Service-role key: trusted internal call (from DB trigger)
      isServiceRoleCall = true
    } else {
      // User JWT: requires authorization check
      const supabaseWithUserToken = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
      const { data: { user }, error: authError } = await supabaseWithUserToken.auth.getUser()
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Invalid authentication token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      authenticatedUserId = user.id
    }

    // Parse request
    const { meeting_id }: MeetingMinutesRequest = await req.json()

    if (!meeting_id) {
      return new Response(
        JSON.stringify({ error: 'meeting_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with service role for data access
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Authorization check for user-initiated calls BEFORE fetching meeting
    // This prevents meeting ID enumeration via 404 vs 403 responses
    // STRICT: Only meeting participants can trigger email notifications
    if (!isServiceRoleCall && authenticatedUserId) {
      const { data: isParticipant } = await supabase
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meeting_id)
        .eq('user_id', authenticatedUserId)
        .single()

      if (!isParticipant) {
        // Return generic 403 - does not reveal if meeting exists
        return new Response(
          JSON.stringify({ error: 'Not authorized' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get meeting details (only after authorization check for user calls)
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meeting_id)
      .single()

    if (meetingError || !meeting) {
      console.error('Meeting not found:', meetingError)
      return new Response(
        JSON.stringify({ error: 'Meeting not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate meeting status
    if (meeting.status !== 'ended') {
      return new Response(
        JSON.stringify({ error: 'Meeting has not ended yet' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get all recipients with their profile info
    const recipients: Recipient[] = []
    const warnings: string[] = []

    // 1. Meeting participants
    const { data: participants, error: participantsError } = await supabase
      .from('meeting_participants')
      .select(`
        user_id,
        side,
        profiles:user_id (
          email,
          display_name
        )
      `)
      .eq('meeting_id', meeting_id)

    if (participantsError) {
      console.error('Failed to fetch participants:', participantsError)
      warnings.push('Failed to fetch meeting participants')
    } else if (participants) {
      for (const p of participants) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile = (p as any).profiles
        if (profile?.email) {
          recipients.push({
            user_id: p.user_id,
            email: profile.email,
            side: p.side as 'client' | 'internal',
            display_name: profile.display_name,
          })
        }
      }
    }

    // 2. Task owners of ball=client tasks who aren't already participants
    const { data: taskOwners, error: taskOwnersError } = await supabase
      .from('task_owners')
      .select(`
        user_id,
        side,
        profiles:user_id (
          email,
          display_name
        ),
        tasks!inner (
          space_id,
          ball
        )
      `)
      .eq('tasks.space_id', meeting.space_id)
      .eq('tasks.ball', 'client')

    if (taskOwnersError) {
      console.error('Failed to fetch task owners:', taskOwnersError)
      warnings.push('Failed to fetch task owners')
    } else if (taskOwners) {
      for (const to of taskOwners) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile = (to as any).profiles
        const existingRecipient = recipients.find(r => r.user_id === to.user_id)
        if (!existingRecipient && profile?.email) {
          recipients.push({
            user_id: to.user_id,
            email: profile.email,
            side: to.side as 'client' | 'internal',
            display_name: profile.display_name,
          })
        }
      }
    }

    // Generate meeting minutes using RPC
    const { data: minutes, error: minutesError } = await supabase
      .rpc('rpc_generate_meeting_minutes', { p_meeting_id: meeting_id })

    if (minutesError) {
      console.error('Failed to generate minutes:', minutesError)
      return new Response(
        JSON.stringify({ error: 'Failed to generate meeting minutes' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Dedupe key for notifications
    const dedupeKey = `meeting_email:${meeting_id}`

    // Send notifications to each recipient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notifications: any[] = []
    const emailsSent: string[] = []

    for (const recipient of recipients) {
      // Prepare content based on recipient type
      const isClient = recipient.side === 'client'

      // Filter content for clients (remove internal-only info)
      const emailBody = isClient
        ? filterContentForClient(minutes.email_body)
        : minutes.email_body

      // Create email notification record
      const emailNotification = {
        org_id: meeting.org_id,
        space_id: meeting.space_id,
        to_user_id: recipient.user_id,
        channel: 'email',
        type: 'meeting_ended',
        dedupe_key: dedupeKey,
        payload: {
          title: minutes.email_subject,
          message: minutes.in_app_body,
          meeting_id: meeting_id,
          meeting_title: meeting.title,
          email_subject: minutes.email_subject,
          email_body: emailBody,
          decided_count: minutes.counts.decided,
          open_count: minutes.counts.open,
          ball_client_count: minutes.counts.ball_client,
          recipient_email: recipient.email,
          recipient_side: recipient.side,
        },
      }

      notifications.push(emailNotification)
      emailsSent.push(recipient.email)
    }

    // Upsert notifications (idempotent via dedupe_key)
    if (notifications.length > 0) {
      const { error: insertError } = await supabase
        .from('notifications')
        .upsert(notifications, {
          onConflict: 'to_user_id,channel,dedupe_key',
          ignoreDuplicates: true,
        })

      if (insertError) {
        console.error('Failed to insert notifications:', insertError)
        // Continue - don't fail the whole request
      }
    }

    // TODO: Integrate with email service (Resend, SendGrid, etc.)
    // For now, we just record the email notifications in the database
    // The actual email sending would be handled by a separate worker or service

    console.log(`Meeting ${meeting_id}: Queued ${emailsSent.length} email notifications`)

    return new Response(
      JSON.stringify({
        success: true,
        meeting_id,
        recipients_count: recipients.length,
        // Note: emails_queued removed to reduce PII exposure
        // Email addresses are logged server-side only
        notifications_queued: emailsSent.length,
        ...(warnings.length > 0 && { warnings }),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing meeting minutes:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Filter email content for client recipients
 * Removes internal-only information
 */
function filterContentForClient(content: string): string {
  // Remove lines that contain internal markers
  const lines = content.split('\n')
  const filteredLines = lines.filter(line => {
    // Remove internal task references (TP-XXX internal tags)
    if (line.includes('[内部]') || line.includes('[Internal]')) {
      return false
    }
    // Remove internal assignee info
    if (line.includes('担当者(社内):')) {
      return false
    }
    return true
  })
  return filteredLines.join('\n')
}

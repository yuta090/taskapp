import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { videoConferenceRegistry } from '@/lib/video-conference'
import type { VideoConferenceProviderName } from '@/lib/video-conference'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

import { UUID_REGEX } from '@/lib/uuid'

// POST: スロット確定
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: proposalId } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!UUID_REGEX.test(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID' }, { status: 400 })
    }

    const body = await request.json()
    const { slotId } = body

    if (!slotId || !UUID_REGEX.test(slotId)) {
      return NextResponse.json({ error: 'Invalid or missing slotId' }, { status: 400 })
    }

    // Authorization: creator or admin
    const { data: proposal } = await (supabase as SupabaseClient)
      .from('scheduling_proposals')
      .select('id, space_id, created_by, video_provider, title, duration_minutes')
      .eq('id', proposalId)
      .single()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    if (proposal.created_by !== user.id) {
      const { data: adminMembership } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .select('id')
        .eq('space_id', proposal.space_id)
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .single()

      if (!adminMembership) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Call RPC for atomic confirmation
    const { data: result, error: rpcError } = await (supabase as SupabaseClient)
      .rpc('rpc_confirm_proposal_slot', {
        p_proposal_id: proposalId,
        p_slot_id: slotId,
      })

    if (rpcError) {
      console.error('Confirm RPC error:', rpcError)
      return NextResponse.json({ error: 'Failed to confirm slot' }, { status: 500 })
    }

    if (!result?.ok) {
      const statusCode = result?.error === 'proposal_not_open' ? 409
        : result?.error === 'not_all_agreed' ? 400
        : 500
      return NextResponse.json(result, { status: statusCode })
    }

    // Phase 3: ビデオ会議作成（失敗しても会議確定はブロックしない）
    let meetingUrl: string | null = null
    let externalMeetingId: string | null = null

    if (proposal.video_provider) {
      const provider = videoConferenceRegistry.get(
        proposal.video_provider as VideoConferenceProviderName,
      )

      if (provider && provider.isConfigured()) {
        try {
          // 参加者情報を取得（respondents → profiles join）。profilesにemail列は無いため、
          // 名前はprofilesから、メールはサーバーの管理用の鍵(admin.auth.admin)で解決する
          const { data: respondents, error: respondentsError } = await (supabase as SupabaseClient)
            .from('proposal_respondents')
            .select('user_id, profiles!inner(display_name)')
            .eq('proposal_id', proposalId)

          if (respondentsError) {
            console.error('Failed to fetch respondents (non-blocking):', respondentsError)
          }

          type RespondentRow = { user_id: string; profiles: { display_name: string | null }[] | { display_name: string | null } }
          const respondentRows = (respondents as RespondentRow[]) || []

          const admin = createAdminClient()
          const emailByUserId = new Map<string, string>()
          await Promise.all(
            respondentRows.map(async (r) => {
              const { data } = await admin.auth.admin.getUserById(r.user_id)
              if (data.user?.email) emailByUserId.set(r.user_id, data.user.email)
            })
          )

          const participants = respondentRows
            .map((r) => {
              const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
              const email = emailByUserId.get(r.user_id)
              return email ? { email, name: profile?.display_name || '' } : null
            })
            .filter((p): p is { email: string; name: string } => p !== null)

          const videoResult = await provider.createMeeting({
            title: proposal.title,
            startAt: result.slot_start,
            endAt: result.slot_end,
            participants,
            idempotencyKey: `proposal-${proposalId}-slot-${slotId}`,
            createdByUserId: proposal.created_by,
          })

          meetingUrl = videoResult.meetingUrl
          externalMeetingId = videoResult.externalMeetingId

          // proposals テーブルにビデオ会議情報を保存
          await (supabase as SupabaseClient)
            .from('scheduling_proposals')
            .update({
              meeting_url: meetingUrl,
              external_meeting_id: externalMeetingId,
            })
            .eq('id', proposalId)

          // meetings テーブルにもビデオ会議情報を保存
          if (result.meeting_id) {
            await (supabase as SupabaseClient)
              .from('meetings')
              .update({
                meeting_url: meetingUrl,
                external_meeting_id: externalMeetingId,
                video_provider: proposal.video_provider,
              })
              .eq('id', result.meeting_id)
          }
        } catch (videoError) {
          // ビデオ会議作成失敗は会議確定をブロックしない
          console.error('Video conference creation failed (non-blocking):', videoError)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      meetingId: result.meeting_id,
      slotStart: result.slot_start,
      slotEnd: result.slot_end,
      meetingUrl,
      externalMeetingId,
    })
  } catch (error) {
    console.error('Confirm proposal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

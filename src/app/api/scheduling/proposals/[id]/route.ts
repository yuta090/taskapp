import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET: 提案詳細取得
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid proposal ID' }, { status: 400 })
    }

    // Fetch proposal with related data
    // Note: Must use explicit FK name because scheduling_proposals has TWO relations
    // to proposal_slots (proposal_slots.proposal_id and scheduling_proposals.confirmed_slot_id)
    const { data: proposal, error } = await (supabase as SupabaseClient)
      .from('scheduling_proposals')
      .select(`
        *,
        proposal_slots!proposal_slots_proposal_id_fkey (*, slot_responses (id, slot_id, respondent_id, response, responded_at)),
        proposal_respondents (id, user_id, side, is_required)
      `)
      .eq('id', id)
      .single()

    if (error || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Authorization: space member
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id')
      .eq('space_id', proposal.space_id)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Resolve display names for respondents
    const userIds = (proposal.proposal_respondents || []).map((r: { user_id: string }) => r.user_id)
    const profileMap: Record<string, { display_name: string; avatar_url: string | null }> = {}

    if (userIds.length > 0) {
      const { data: profiles } = await (supabase as SupabaseClient)
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds)

      if (profiles) {
        for (const p of profiles) {
          profileMap[p.id] = { display_name: p.display_name || '', avatar_url: p.avatar_url }
        }
      }
    }

    // Enrich respondents with profiles
    const enrichedRespondents = (proposal.proposal_respondents || []).map((r: { id: string; user_id: string; side: string; is_required: boolean }) => ({
      ...r,
      displayName: profileMap[r.user_id]?.display_name || '',
      avatarUrl: profileMap[r.user_id]?.avatar_url || null,
    }))

    // Enrich slots with response details
    const enrichedSlots = (proposal.proposal_slots || []).map((slot: { id: string; slot_responses?: Array<{ id: string; respondent_id: string; response: string; responded_at: string; user_id?: string }> }) => ({
      ...slot,
      responses: (slot.slot_responses || []).map((sr: { id: string; respondent_id: string; response: string; responded_at: string; user_id?: string }) => {
        const respondent = (proposal.proposal_respondents || []).find(
          (r: { id: string }) => r.id === sr.respondent_id
        )
        return {
          ...sr,
          userId: respondent?.user_id || '',
          displayName: respondent ? (profileMap[respondent.user_id]?.display_name || '') : '',
          side: respondent?.side || '',
        }
      }),
    }))

    return NextResponse.json({
      proposal: {
        ...proposal,
        proposal_slots: enrichedSlots,
        proposal_respondents: enrichedRespondents,
      },
    })
  } catch (error) {
    console.error('Get proposal detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH: ステータス更新（キャンセルのみ）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid proposal ID' }, { status: 400 })
    }

    const body = await request.json()
    if (body.status !== 'cancelled') {
      return NextResponse.json({ error: 'Only cancel is allowed' }, { status: 400 })
    }

    // Fetch proposal
    const { data: proposal } = await (supabase as SupabaseClient)
      .from('scheduling_proposals')
      .select('id, space_id, created_by, status')
      .eq('id', id)
      .single()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    if (proposal.status !== 'open') {
      return NextResponse.json(
        { error: 'Proposal is not open', currentStatus: proposal.status },
        { status: 409 }
      )
    }

    // Authorization: creator or admin
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

    const { error: updateError } = await (supabase as SupabaseClient)
      .from('scheduling_proposals')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'open')

    if (updateError) {
      console.error('Cancel proposal error:', updateError)
      return NextResponse.json({ error: 'Failed to cancel proposal' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Patch proposal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

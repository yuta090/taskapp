import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// GET: ポータルクライアント向け — 自分がrespondentの提案一覧
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')

    // Verify user has at least one client membership (portal access guard)
    const membershipQuery = supabase
      .from('space_memberships')
      .select('id, role, space_id')
      .eq('user_id', user.id)
      .eq('role', 'client')

    if (spaceId) {
      membershipQuery.eq('space_id', spaceId)
    }

    const { data: clientMemberships } = await membershipQuery

    if (!clientMemberships || clientMemberships.length === 0) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Fetch proposals where user is a respondent
    const { data: respondentRecords, error: respError } = await (supabase as SupabaseClient)
      .from('proposal_respondents')
      .select('proposal_id')
      .eq('user_id', user.id)

    if (respError) {
      console.error('Fetch respondent records error:', respError)
      return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 })
    }

    const proposalIds = (respondentRecords || []).map((r: { proposal_id: string }) => r.proposal_id)

    if (proposalIds.length === 0) {
      return NextResponse.json({ proposals: [] })
    }

    let query = supabase
      .from('scheduling_proposals')
      .select(`
        *,
        proposal_slots (*),
        proposal_respondents (id, user_id, side, is_required)
      `)
      .in('id', proposalIds)
      .order('created_at', { ascending: false })

    if (spaceId) {
      query = query.eq('space_id', spaceId)
    }

    const { data: proposals, error: proposalsError } = await query

    if (proposalsError) {
      console.error('Fetch proposals error:', proposalsError)
      return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 })
    }

    // Check which proposals the user has responded to
    // Collect my respondent IDs from all proposals
    const myRespondentIds = (proposals || [])
      .flatMap((p: { proposal_respondents?: Array<{ id: string; user_id: string }> }) => p.proposal_respondents || [])
      .filter((pr: { user_id: string }) => pr.user_id === user.id)
      .map((pr: { id: string }) => pr.id)

    let myResponses: Array<{ slot_id: string }> = []
    if (myRespondentIds.length > 0) {
      const { data } = await (supabase as SupabaseClient)
        .from('slot_responses')
        .select('slot_id, respondent_id')
        .in('respondent_id', myRespondentIds)
      myResponses = data || []
    }

    const respondedSlotIds = new Set((myResponses || []).map((r: { slot_id: string }) => r.slot_id))

    const result = (proposals || []).map((p: { id: string; status: string; proposal_respondents?: Array<{ id: string; user_id: string }>; proposal_slots?: Array<{ id: string }> }) => {
      const myRespondent = (p.proposal_respondents || []).find(
        (r: { id: string; user_id: string }) => r.user_id === user.id
      )
      const totalSlots = (p.proposal_slots || []).length
      const answeredSlots = (p.proposal_slots || []).filter(
        (s: { id: string }) => respondedSlotIds.has(s.id)
      ).length

      return {
        ...p,
        myRespondentId: myRespondent?.id || null,
        hasResponded: answeredSlots >= totalSlots && totalSlots > 0,
        answeredSlots,
        totalSlots,
      }
    })

    return NextResponse.json({ proposals: result })
  } catch (error) {
    console.error('Portal proposals error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// POST: 提案作成
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { spaceId, title, description, durationMinutes, slots, respondents, expiresAt } = body

    // --- Validation ---
    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'Invalid or missing spaceId' }, { status: 400 })
    }
    if (!title || typeof title !== 'string' || title.length < 1 || title.length > 200) {
      return NextResponse.json({ error: 'Title is required (1-200 chars)' }, { status: 400 })
    }
    if (description && description.length > 1000) {
      return NextResponse.json({ error: 'Description must be 1000 chars or less' }, { status: 400 })
    }
    const duration = Number(durationMinutes)
    if (!duration || duration < 15 || duration > 480) {
      return NextResponse.json({ error: 'durationMinutes must be 15-480' }, { status: 400 })
    }
    if (!Array.isArray(slots) || slots.length < 2 || slots.length > 5) {
      return NextResponse.json({ error: 'Must provide 2-5 slots' }, { status: 400 })
    }
    if (!Array.isArray(respondents) || respondents.length === 0) {
      return NextResponse.json({ error: 'Must provide at least 1 respondent' }, { status: 400 })
    }
    if (respondents.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 respondents allowed' }, { status: 400 })
    }

    // AT-001: At least 1 client respondent
    const hasClient = respondents.some((r: { side: string }) => r.side === 'client')
    if (!hasClient) {
      return NextResponse.json({ error: 'At least 1 client respondent is required' }, { status: 400 })
    }

    // Validate each slot
    const now = new Date()
    for (const slot of slots) {
      if (!slot.startAt || !slot.endAt) {
        return NextResponse.json({ error: 'Each slot requires startAt and endAt' }, { status: 400 })
      }
      const start = new Date(slot.startAt)
      const end = new Date(slot.endAt)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return NextResponse.json({ error: 'Invalid date format in slots' }, { status: 400 })
      }
      if (end <= start) {
        return NextResponse.json({ error: 'endAt must be after startAt' }, { status: 400 })
      }
      if (start <= now) {
        return NextResponse.json({ error: 'Slot dates must be in the future' }, { status: 400 })
      }
    }

    // Validate respondents
    for (const r of respondents) {
      if (!r.userId || !UUID_REGEX.test(r.userId)) {
        return NextResponse.json({ error: 'Invalid respondent userId' }, { status: 400 })
      }
      if (!['client', 'internal'].includes(r.side)) {
        return NextResponse.json({ error: 'Respondent side must be client or internal' }, { status: 400 })
      }
    }

    // --- Authorization ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership } = await (supabase as any)
      .from('space_memberships')
      .select('id, role')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .in('role', ['admin', 'editor', 'member'])
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get org_id from space
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: space } = await (supabase as any)
      .from('spaces')
      .select('org_id')
      .eq('id', spaceId)
      .single()

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // --- Create proposal ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proposal, error: proposalError } = await (supabase as any)
      .from('scheduling_proposals')
      .insert({
        org_id: space.org_id,
        space_id: spaceId,
        title: title.trim(),
        description: description?.trim() || null,
        duration_minutes: duration,
        status: 'open',
        expires_at: expiresAt || null,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (proposalError || !proposal) {
      console.error('Proposal creation error:', proposalError)
      return NextResponse.json({ error: 'Failed to create proposal' }, { status: 500 })
    }

    // --- Create slots ---
    const slotInserts = slots.map((slot: { startAt: string; endAt: string }, idx: number) => ({
      proposal_id: proposal.id,
      start_at: slot.startAt,
      end_at: slot.endAt,
      slot_order: idx,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: createdSlots, error: slotsError } = await (supabase as any)
      .from('proposal_slots')
      .insert(slotInserts)
      .select('*')

    if (slotsError) {
      console.error('Slots creation error:', slotsError)
      return NextResponse.json({ error: 'Failed to create slots' }, { status: 500 })
    }

    // --- Create respondents ---
    const respondentInserts = respondents.map((r: { userId: string; side: string; isRequired?: boolean }) => ({
      proposal_id: proposal.id,
      user_id: r.userId,
      side: r.side,
      is_required: r.isRequired !== false,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: createdRespondents, error: respondentsError } = await (supabase as any)
      .from('proposal_respondents')
      .insert(respondentInserts)
      .select('*')

    if (respondentsError) {
      console.error('Respondents creation error:', respondentsError)
      return NextResponse.json({ error: 'Failed to create respondents' }, { status: 500 })
    }

    return NextResponse.json({
      proposal: {
        ...proposal,
        slots: createdSlots,
        respondents: createdRespondents,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Create proposal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET: 一覧取得
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')

    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'Invalid or missing spaceId' }, { status: 400 })
    }

    // Authorization: space member
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership } = await (supabase as any)
      .from('space_memberships')
      .select('id')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Fetch proposals with counts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proposals, error } = await (supabase as any)
      .from('scheduling_proposals')
      .select(`
        *,
        proposal_slots (*),
        proposal_respondents (id, user_id, side, is_required)
      `)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Fetch proposals error:', error)
      return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 })
    }

    // Count responses per proposal
    const proposalIds = (proposals || []).map((p: { id: string }) => p.id)
    let responseCountMap: Record<string, number> = {}

    if (proposalIds.length > 0) {
      // Get distinct respondent counts with responses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: responseCounts } = await (supabase as any)
        .from('slot_responses')
        .select('respondent_id, proposal_respondents!inner(proposal_id)')
        .in('proposal_respondents.proposal_id', proposalIds)

      if (responseCounts) {
        const respondentsByProposal: Record<string, Set<string>> = {}
        for (const rc of responseCounts) {
          const pid = rc.proposal_respondents?.proposal_id
          if (pid) {
            if (!respondentsByProposal[pid]) respondentsByProposal[pid] = new Set()
            respondentsByProposal[pid].add(rc.respondent_id)
          }
        }
        for (const [pid, respondents] of Object.entries(respondentsByProposal)) {
          responseCountMap[pid] = respondents.size
        }
      }
    }

    const result = (proposals || []).map((p: any) => ({
      ...p,
      respondentCount: p.proposal_respondents?.length || 0,
      responseCount: responseCountMap[p.id] || 0,
    }))

    return NextResponse.json({ proposals: result })
  } catch (error) {
    console.error('List proposals error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

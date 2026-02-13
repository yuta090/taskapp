import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VALID_RESPONSES = ['available', 'unavailable_but_proceed', 'unavailable']

// POST: 回答送信（内部ユーザー用）
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { proposalId, responses } = body

    // --- Validation ---
    if (!proposalId || !UUID_REGEX.test(proposalId)) {
      return NextResponse.json({ error: 'Invalid or missing proposalId' }, { status: 400 })
    }
    if (!Array.isArray(responses) || responses.length === 0) {
      return NextResponse.json({ error: 'Must provide at least 1 response' }, { status: 400 })
    }
    if (responses.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 responses per submission' }, { status: 400 })
    }

    const seenSlotIds = new Set<string>()
    for (const r of responses) {
      if (!r.slotId || !UUID_REGEX.test(r.slotId)) {
        return NextResponse.json({ error: 'Invalid slotId in responses' }, { status: 400 })
      }
      if (seenSlotIds.has(r.slotId)) {
        return NextResponse.json({ error: 'Duplicate slotId in responses' }, { status: 400 })
      }
      seenSlotIds.add(r.slotId)
      if (!VALID_RESPONSES.includes(r.response)) {
        return NextResponse.json(
          { error: `Invalid response value. Must be one of: ${VALID_RESPONSES.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Verify proposal is open
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proposal } = await (supabase as any)
      .from('scheduling_proposals')
      .select('id, status, expires_at')
      .eq('id', proposalId)
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

    // Check expiration
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Proposal has expired' }, { status: 409 })
    }

    // Verify user is a respondent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: respondent } = await (supabase as any)
      .from('proposal_respondents')
      .select('id')
      .eq('proposal_id', proposalId)
      .eq('user_id', user.id)
      .single()

    if (!respondent) {
      return NextResponse.json({ error: 'You are not a respondent for this proposal' }, { status: 403 })
    }

    // Verify all slotIds belong to this proposal
    const slotIds = responses.map((r: { slotId: string }) => r.slotId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: validSlots } = await (supabase as any)
      .from('proposal_slots')
      .select('id')
      .eq('proposal_id', proposalId)
      .in('id', slotIds)

    if (!validSlots || validSlots.length !== slotIds.length) {
      return NextResponse.json({ error: 'One or more slotIds do not belong to this proposal' }, { status: 400 })
    }

    // Upsert responses
    const upsertData = responses.map((r: { slotId: string; response: string }) => ({
      slot_id: r.slotId,
      respondent_id: respondent.id,
      response: r.response,
      responded_at: new Date().toISOString(),
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (supabase as any)
      .from('slot_responses')
      .upsert(upsertData, {
        onConflict: 'slot_id,respondent_id',
      })

    if (upsertError) {
      console.error('Upsert responses error:', upsertError)
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, updatedCount: responses.length })
  } catch (error) {
    console.error('Submit responses error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

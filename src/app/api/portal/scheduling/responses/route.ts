import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VALID_RESPONSES = ['available', 'unavailable_but_proceed', 'unavailable']

// POST: ポータルクライアント用回答送信
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const body = await request.json()
    const { proposalId, responses } = body

    // --- Validation ---
    if (!proposalId || !UUID_REGEX.test(proposalId)) {
      return NextResponse.json({ error: '無効な日程調整IDです' }, { status: 400 })
    }
    if (!Array.isArray(responses) || responses.length === 0) {
      return NextResponse.json({ error: '回答を1つ以上入力してください' }, { status: 400 })
    }
    if (responses.length > 5) {
      return NextResponse.json({ error: '一度に送信できる回答は5件までです' }, { status: 400 })
    }

    const seenSlotIds = new Set<string>()
    for (const r of responses) {
      if (!r.slotId || !UUID_REGEX.test(r.slotId)) {
        return NextResponse.json({ error: '無効な候補日IDです' }, { status: 400 })
      }
      if (seenSlotIds.has(r.slotId)) {
        return NextResponse.json({ error: '回答に重複した候補日があります' }, { status: 400 })
      }
      seenSlotIds.add(r.slotId)
      if (!VALID_RESPONSES.includes(r.response)) {
        return NextResponse.json(
          { error: '無効な回答値です' },
          { status: 400 }
        )
      }
    }

    // Verify proposal is open
     
    const { data: proposal } = await (supabase as SupabaseClient)
      .from('scheduling_proposals')
      .select('id, space_id, status, expires_at')
      .eq('id', proposalId)
      .single()

    if (!proposal) {
      return NextResponse.json({ error: '日程調整が見つかりません' }, { status: 404 })
    }

    if (proposal.status !== 'open') {
      return NextResponse.json(
        { error: 'この日程調整は受付終了しています', currentStatus: proposal.status },
        { status: 409 }
      )
    }

    // Check expiration
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return NextResponse.json({ error: '回答期限が過ぎています' }, { status: 409 })
    }

    // Authorization: user must be a client member of the space
     
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id, role')
      .eq('space_id', proposal.space_id)
      .eq('user_id', user.id)
      .eq('role', 'client')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 })
    }

    // Verify user is a respondent
     
    const { data: respondent } = await (supabase as SupabaseClient)
      .from('proposal_respondents')
      .select('id')
      .eq('proposal_id', proposalId)
      .eq('user_id', user.id)
      .single()

    if (!respondent) {
      return NextResponse.json({ error: 'この日程調整の回答者ではありません' }, { status: 403 })
    }

    // Verify all slotIds belong to this proposal
    const slotIds = responses.map((r: { slotId: string }) => r.slotId)
     
    const { data: validSlots } = await (supabase as SupabaseClient)
      .from('proposal_slots')
      .select('id')
      .eq('proposal_id', proposalId)
      .in('id', slotIds)

    if (!validSlots || validSlots.length !== slotIds.length) {
      return NextResponse.json({ error: '無効な候補日が含まれています' }, { status: 400 })
    }

    // Upsert responses
    const upsertData = responses.map((r: { slotId: string; response: string }) => ({
      slot_id: r.slotId,
      respondent_id: respondent.id,
      response: r.response,
      responded_at: new Date().toISOString(),
    }))

     
    const { error: upsertError } = await (supabase as SupabaseClient)
      .from('slot_responses')
      .upsert(upsertData, {
        onConflict: 'slot_id,respondent_id',
      })

    if (upsertError) {
      console.error('Upsert responses error:', upsertError)
      return NextResponse.json({ error: '回答の保存に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, updatedCount: responses.length })
  } catch (error) {
    console.error('Portal submit responses error:', error)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

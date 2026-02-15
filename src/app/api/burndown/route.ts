import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeBurndown } from '@/lib/burndown/computeBurndown'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const spaceId = searchParams.get('spaceId')
  const rawMilestoneId = searchParams.get('milestoneId')
  const milestoneId = rawMilestoneId && rawMilestoneId.trim() !== '' ? rawMilestoneId.trim() : null

  if (!spaceId) {
    return NextResponse.json(
      { error: 'spaceId is required' },
      { status: 400 }
    )
  }

  // Auth check
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const data = await computeBurndown(supabase, spaceId, milestoneId)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    // Known user-facing errors (400)
    if (message.includes('設定してください') || message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    // Internal errors: log details, return generic message
    console.error('[Burndown API]', err)
    return NextResponse.json(
      { error: 'バーンダウンデータの取得に失敗しました' },
      { status: 500 }
    )
  }
}

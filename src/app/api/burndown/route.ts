import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeBurndown } from '@/lib/burndown/computeBurndown'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const spaceId = searchParams.get('spaceId')
  const milestoneId = searchParams.get('milestoneId')

  if (!spaceId || !milestoneId) {
    return NextResponse.json(
      { error: 'spaceId and milestoneId are required' },
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
    const message = err instanceof Error ? err.message : 'Internal server error'
    const status = message.includes('設定してください') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

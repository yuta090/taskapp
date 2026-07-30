import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { UUID_REGEX } from '@/lib/uuid'
import { isImplementedAccountingProvider } from '@/lib/accounting/implemented'
import { connectionErrorResponse, resolveAccountingConnection } from '@/lib/accounting/connection'
import type { AccountingProviderId } from '@/lib/accounting/types'

export const runtime = 'nodejs'

/**
 * 発行先（会計サービス側の取引先）の一覧と、スペースへの紐付け。
 *
 * 取引先を TaskApp から**作らない**のが方針。会計側の取引先マスタは請求・入金消込の土台で、
 * 表記ゆれた重複行が増えると経理の実務が壊れる。既存の取引先から人が1度選び、以後は憶える。
 */

/** 取引先を選び直せるのは編集権限のある内部メンバーだけ（請求先が変わる操作のため）。 */
const ALLOWED_ROLES = new Set(['admin', 'editor'])

async function assertSpaceEditor(
  supabase: SupabaseClient,
  userId: string,
  spaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('space_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('space_id', spaceId)
    .maybeSingle()
  return Boolean(data && ALLOWED_ROLES.has(data.role))
}

/** GET /api/accounting/partners?spaceId=&provider=&q= — 会計サービス側の取引先を引く。 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')
    const provider = searchParams.get('provider')
    const query = searchParams.get('q') ?? undefined

    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'spaceId が不正です' }, { status: 400 })
    }
    if (!provider || !isImplementedAccountingProvider(provider)) {
      return NextResponse.json({ error: '対応していない連携先です' }, { status: 400 })
    }
    if (!(await assertSpaceEditor(supabase as SupabaseClient, user.id, spaceId))) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: space } = await (admin as SupabaseClient)
      .from('spaces')
      .select('org_id')
      .eq('id', spaceId)
      .single()
    if (!space) return NextResponse.json({ error: 'スペースが見つかりません' }, { status: 404 })

    const connection = await resolveAccountingConnection(space.org_id, provider as AccountingProviderId)
    if (connection.status !== 'ok') {
      const { error, httpStatus } = connectionErrorResponse(connection.status)
      return NextResponse.json({ error }, { status: httpStatus })
    }

    const partners = await connection.adapter.listPartners(connection.ctx, { query })
    return NextResponse.json({ partners })
  } catch (err) {
    console.error('accounting partners GET error:', err)
    return NextResponse.json(
      { error: `取引先の取得に失敗しました: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}

interface LinkBody {
  spaceId?: string
  provider?: string
  externalPartnerId?: string
  externalPartnerName?: string | null
}

/** PUT /api/accounting/partners — このスペースの発行先を決める（1スペース×1サービスで1つ）。 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as LinkBody
    const { spaceId, provider, externalPartnerId } = body

    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'spaceId が不正です' }, { status: 400 })
    }
    if (!provider || !isImplementedAccountingProvider(provider)) {
      return NextResponse.json({ error: '対応していない連携先です' }, { status: 400 })
    }
    if (!externalPartnerId || typeof externalPartnerId !== 'string') {
      return NextResponse.json({ error: '取引先が選ばれていません' }, { status: 400 })
    }
    if (!(await assertSpaceEditor(supabase as SupabaseClient, user.id, spaceId))) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: space } = await (admin as SupabaseClient)
      .from('spaces')
      .select('org_id')
      .eq('id', spaceId)
      .single()
    if (!space) return NextResponse.json({ error: 'スペースが見つかりません' }, { status: 404 })

    const { error } = await (admin as SupabaseClient).from('accounting_partner_links').upsert(
      {
        org_id: space.org_id,
        space_id: spaceId,
        provider,
        external_partner_id: externalPartnerId,
        external_partner_name: body.externalPartnerName ?? null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'space_id,provider' },
    )

    if (error) {
      console.error('accounting_partner_links upsert failed:', error)
      return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('accounting partners PUT error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

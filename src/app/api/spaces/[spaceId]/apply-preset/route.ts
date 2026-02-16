import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPreset, isValidPresetGenre } from '@/lib/presets'
import type { PresetGenre } from '@/lib/presets'

/**
 * POST /api/spaces/[spaceId]/apply-preset
 *
 * Applies a preset template to an existing space (wiki pages + milestones).
 * Only works when the space has 0 wiki pages AND 0 milestones.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params
  const supabase = await createClient()

  // 1. Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse & validate request body
  let body: { presetGenre: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { presetGenre } = body

  if (!presetGenre || !isValidPresetGenre(presetGenre)) {
    return NextResponse.json({ error: 'Invalid presetGenre' }, { status: 400 })
  }
  if (presetGenre === 'blank') {
    return NextResponse.json({ error: 'Cannot apply blank preset' }, { status: 400 })
  }

  const genre = presetGenre as PresetGenre
  const preset = getPreset(genre)

  // 3. Fetch orgId from space
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: spaceData } = await (supabase as any)
    .from('spaces')
    .select('org_id')
    .eq('id', spaceId)
    .single()

  if (!spaceData) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }
  const orgId = spaceData.org_id as string

  // 4. Build milestones JSON for RPC
  const milestones = preset.milestones.map(m => ({
    name: m.name,
    order_key: m.orderKey,
  }))

  // 5. Build wiki pages JSON for RPC
  const wikiPages = preset.wikiPages.map(wp => ({
    title: wp.title,
    body: wp.generateBody(orgId, spaceId, []),
    tags: wp.tags,
    is_home: wp.isHome ?? false,
  }))

  // 6. Call RPC for atomic application
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcResult, error: rpcError } = await (supabase as any).rpc(
    'rpc_apply_preset_to_space',
    {
      p_space_id: spaceId,
      p_preset_genre: genre,
      p_milestones: milestones,
      p_wiki_pages: wikiPages,
      p_owner_field_enabled: preset.defaultSettings.ownerFieldEnabled,
    },
  )

  if (rpcError) {
    console.error('[apply-preset] RPC error:', rpcError)
    return NextResponse.json(
      { error: rpcError.message || 'Failed to apply preset' },
      { status: 500 },
    )
  }

  if (!rpcResult?.ok) {
    const errorMsg = rpcResult?.error || 'Unknown error'
    const status = errorMsg === 'authentication_required' ? 401
      : errorMsg === 'insufficient_permissions' ? 403
      : errorMsg === 'space_not_found' ? 404
      : errorMsg === 'space_not_empty' ? 409
      : errorMsg === 'preset_already_applied' ? 409
      : 400
    return NextResponse.json({ error: errorMsg, ...rpcResult }, { status })
  }

  // 7. Update home page with real spec page links (non-critical)
  if (genre !== 'blank' && preset.wikiPages.some(p => p.isHome)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: allPages } = await (supabase as any)
        .from('wiki_pages')
        .select('id, title, tags')
        .eq('space_id', spaceId)
        .eq('org_id', orgId)

      const pages = (allPages || []) as { id: string; title: string; tags: string[] }[]
      const homePage = pages.find(p => p.tags.includes('ホーム'))
      const specPages = pages
        .filter(p => !p.tags.includes('ホーム'))
        .map(p => ({ id: p.id, title: p.title }))

      const homePreset = preset.wikiPages.find(p => p.isHome)
      if (homePreset && homePage && specPages.length > 0) {
        const homeBody = homePreset.generateBody(orgId, spaceId, specPages)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('wiki_pages')
          .update({ body: homeBody })
          .eq('id', homePage.id)
      }
    } catch (err) {
      console.warn('[apply-preset] Home page spec link update failed:', err)
    }
  }

  return NextResponse.json({
    milestonesCreated: rpcResult.milestones_created ?? 0,
    wikiPagesCreated: rpcResult.wiki_pages_created ?? 0,
  })
}

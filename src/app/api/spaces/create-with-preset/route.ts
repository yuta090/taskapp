import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPreset, isValidPresetGenre } from '@/lib/presets'
import type { PresetGenre } from '@/lib/presets'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/spaces/create-with-preset
 *
 * Creates a new space with preset content (wiki pages + milestones) atomically.
 * Uses rpc_create_space_with_preset for transactional guarantees.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // 1. Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse & validate request body
  let body: { name: string; presetGenre: string; orgId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, presetGenre, orgId } = body

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!orgId || typeof orgId !== 'string') {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    return NextResponse.json({ error: 'orgId must be a valid UUID' }, { status: 400 })
  }
  if (!presetGenre || !isValidPresetGenre(presetGenre)) {
    return NextResponse.json({ error: 'Invalid presetGenre' }, { status: 400 })
  }

  const genre = presetGenre as PresetGenre
  const preset = getPreset(genre)

  // 3. Build milestones JSON for RPC
  const milestones = preset.milestones.map(m => ({
    name: m.name,
    order_key: m.orderKey,
  }))

  // 4. Build wiki pages JSON for RPC
  //    Home page body uses placeholder paths — updated after space creation
  const wikiPages = preset.wikiPages.map(wp => ({
    title: wp.title,
    body: wp.generateBody(orgId, 'placeholder', []),
    tags: wp.tags,
    is_home: wp.isHome ?? false,
  }))

  // 5. Call RPC for atomic creation (space + membership + milestones + wiki)
   
  const { data: rpcResult, error: rpcError } = await (supabase as SupabaseClient).rpc(
    'rpc_create_space_with_preset',
    {
      p_org_id: orgId,
      p_name: name.trim(),
      p_preset_genre: genre,
      p_milestones: milestones,
      p_wiki_pages: wikiPages,
      p_owner_field_enabled: preset.defaultSettings.ownerFieldEnabled,
    },
  )

  if (rpcError) {
    console.error('[create-with-preset] RPC error:', rpcError)
    return NextResponse.json(
      { error: rpcError.message || 'Failed to create space' },
      { status: 500 },
    )
  }

  if (!rpcResult?.ok) {
    const errorMsg = rpcResult?.error || 'Unknown error'
    const status = errorMsg === 'authentication_required' ? 401
      : errorMsg === 'not_org_member' ? 403
      : 400
    return NextResponse.json({ error: errorMsg }, { status })
  }

  const spaceId = rpcResult.space_id as string

  // 6. Update home page with real spec page links (non-critical)
  if (genre !== 'blank' && preset.wikiPages.some(p => p.isHome)) {
    try {
      // Fetch all created pages to identify home + spec pages
       
      const { data: allPages } = await (supabase as SupabaseClient)
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
        // Update by specific page ID to avoid multi-row updates
         
        await (supabase as SupabaseClient)
          .from('wiki_pages')
          .update({ body: homeBody })
          .eq('id', homePage.id)
      }
    } catch (err) {
      // Non-critical: space is created, just spec links missing from home page
      console.warn('[create-with-preset] Home page spec link update failed:', err)
    }
  }

  return NextResponse.json({
    space: {
      id: spaceId,
      name: name.trim(),
      preset_genre: genre,
      org_id: orgId,
    },
    milestonesCreated: rpcResult.milestones_created ?? 0,
    wikiPagesCreated: rpcResult.wiki_pages_created ?? 0,
  })
}

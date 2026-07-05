/**
 * Home page spec-link update — shared by create-with-preset / apply-preset routes.
 *
 * Space creation generates the home page body with a placeholder spaceId
 * (the real id is unknown until the RPC returns), so this update must run
 * even when there are no spec pages — otherwise broken placeholder links remain.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PresetDefinition } from './index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

interface WikiPageRow {
  id: string
  title: string
  tags: string[]
}

/** Order created spec pages to match the preset definition order (unknown titles last). */
export function sortSpecPagesByPreset(
  preset: PresetDefinition,
  pages: Pick<WikiPageRow, 'id' | 'title'>[],
): SpecPageRef[] {
  const order = new Map(preset.wikiPages.map((p, i) => [p.title, i]))
  return [...pages]
    .sort(
      (a, b) =>
        (order.get(a.title) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.title) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(p => ({ id: p.id, title: p.title }))
}

/**
 * Regenerate the home page body with the real spaceId and spec page links.
 * Retries once on transient failure. Never throws — returns false when the
 * update could not be applied (space itself is already created).
 */
export async function updateHomePageSpecLinks(
  supabase: SupabaseClient,
  preset: PresetDefinition,
  orgId: string,
  spaceId: string,
): Promise<boolean> {
  const homePreset = preset.wikiPages.find(p => p.isHome)
  if (!homePreset) return true

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data: allPages, error: selectError } = await supabase
        .from('wiki_pages')
        .select('id, title, tags')
        .eq('space_id', spaceId)
        .eq('org_id', orgId)
      if (selectError) throw selectError

      const pages = (allPages ?? []) as WikiPageRow[]
      const homePage = pages.find(p => p.tags.includes('ホーム'))
      if (!homePage) return false

      const specPages = sortSpecPagesByPreset(
        preset,
        pages.filter(p => !p.tags.includes('ホーム')),
      )
      const body = homePreset.generateBody(orgId, spaceId, specPages)

      const { error: updateError } = await supabase
        .from('wiki_pages')
        .update({ body })
        .eq('id', homePage.id)
      if (updateError) throw updateError

      return true
    } catch (err) {
      if (attempt === 1) {
        console.warn('[preset] Home page spec link update failed:', err)
      }
    }
  }
  return false
}

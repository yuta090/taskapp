import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortalVisibleSections } from './types'
import { DEFAULT_PORTAL_SECTIONS } from './types'

/**
 * Server-side check: returns true if the given portal section is enabled for the space.
 * Fails closed — on error or missing data, returns false to deny access.
 */
export async function isPortalSectionEnabled(
  supabase: SupabaseClient,
  spaceId: string,
  section: keyof PortalVisibleSections,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('spaces')
    .select('portal_visible_sections')
    .eq('id', spaceId)
    .single()

  if (error || !data) {
    console.error('[Portal] Failed to check section visibility:', error?.message)
    return false
  }

  const sections: PortalVisibleSections = {
    ...DEFAULT_PORTAL_SECTIONS,
    ...(data.portal_visible_sections as Partial<PortalVisibleSections> | null),
  }

  return sections[section]
}

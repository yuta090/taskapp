import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortalVisibleSections } from '@/lib/hooks/usePortalVisibility'

const DEFAULT_SECTIONS: PortalVisibleSections = {
  tasks: true,
  requests: true,
  all_tasks: true,
  files: true,
  meetings: true,
  wiki: false,
  history: true,
}

/**
 * Server-side check: returns true if the given portal section is enabled for the space.
 * Used in portal page.tsx to redirect when a section is disabled.
 */
export async function isPortalSectionEnabled(
  supabase: SupabaseClient,
  spaceId: string,
  section: keyof PortalVisibleSections,
): Promise<boolean> {
  const { data } = await supabase
    .from('spaces')
    .select('portal_visible_sections')
    .eq('id', spaceId)
    .single()

  const sections: PortalVisibleSections = {
    ...DEFAULT_SECTIONS,
    ...(data?.portal_visible_sections as Partial<PortalVisibleSections> | null),
  }

  return sections[section]
}

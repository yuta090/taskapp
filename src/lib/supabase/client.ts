import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Cast a typed SupabaseClient to an untyped one for accessing tables
 * not yet in the Database type definition (e.g., profiles, export_templates).
 * Use `(supabase as UntypedSupabaseClient)` instead of `(supabase as SupabaseClient)`.
 */
export type UntypedSupabaseClient = SupabaseClient

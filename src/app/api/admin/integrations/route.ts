import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateCache } from '@/lib/integrations/system-config'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const VALID_PROVIDERS = ['github', 'slack', 'google_calendar', 'zoom', 'teams'] as const

async function verifySuperadmin(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await (supabase as SupabaseClient)
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .single()

  return profile?.is_superadmin ? user.id : null
}

function getEncryptionKey(): string {
  const key = process.env.SYSTEM_ENCRYPTION_KEY
  if (!key) throw new Error('SYSTEM_ENCRYPTION_KEY is not configured')
  return key
}

/**
 * GET /api/admin/integrations
 * List all integration configs (credentials masked)
 */
export async function GET() {
  const userId = await verifySuperadmin()
  if (!userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin as SupabaseClient)
    .from('system_integration_configs')
    .select('id, provider, enabled, credentials_encrypted, config, updated_at')
    .order('provider')

  if (error) {
    console.error('Failed to fetch integration configs:', error)
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 })
  }

  // Decrypt and mask credentials for display
  const configs = await Promise.all(
    (data ?? []).map(async (row: Record<string, unknown>) => {
      let maskedCredentials: Record<string, string> = {}

      try {
        const { data: decrypted } = await (admin as SupabaseClient)
          .rpc('decrypt_system_secret', {
            encrypted: row.credentials_encrypted,
            secret: getEncryptionKey(),
          })

        if (decrypted && typeof decrypted === 'string') {
          const creds = JSON.parse(decrypted)
          // Show only first 8 chars of each value
          maskedCredentials = Object.fromEntries(
            Object.entries(creds).map(([k, v]) => [
              k,
              typeof v === 'string' && v.length > 8
                ? v.substring(0, 8) + '...'
                : typeof v === 'string' ? '****' : '',
            ]),
          )
        }
      } catch {
        maskedCredentials = { error: 'Failed to decrypt' }
      }

      return {
        id: row.id,
        provider: row.provider,
        enabled: row.enabled,
        maskedCredentials,
        config: row.config,
        updatedAt: row.updated_at,
      }
    }),
  )

  return NextResponse.json({ configs })
}

/**
 * POST /api/admin/integrations
 * Create or update an integration config
 * Body: { provider, enabled, credentials: {...}, config?: {...} }
 */
export async function POST(request: NextRequest) {
  const userId = await verifySuperadmin()
  if (!userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { provider, enabled, credentials, config } = body

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 },
    )
  }

  if (!credentials || typeof credentials !== 'object') {
    return NextResponse.json({ error: 'credentials object is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Encrypt credentials JSON
  const credentialsJson = JSON.stringify(credentials)
  const { data: encrypted, error: encryptError } = await (admin as SupabaseClient)
    .rpc('encrypt_system_secret', {
      plaintext: credentialsJson,
      secret: getEncryptionKey(),
    })

  if (encryptError || !encrypted) {
    console.error('Encryption failed:', encryptError)
    return NextResponse.json({ error: 'Failed to encrypt credentials' }, { status: 500 })
  }

  // Upsert
  const { error: upsertError } = await (admin as SupabaseClient)
    .from('system_integration_configs')
    .upsert(
      {
        provider,
        enabled: enabled ?? false,
        credentials_encrypted: encrypted,
        config: config ?? {},
        updated_by: userId,
      },
      { onConflict: 'provider' },
    )

  if (upsertError) {
    console.error('Upsert failed:', upsertError)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  // Invalidate server cache
  invalidateCache(provider)

  return NextResponse.json({ success: true, provider })
}

/**
 * DELETE /api/admin/integrations?provider=xxx
 * Delete an integration config
 */
export async function DELETE(request: NextRequest) {
  const userId = await verifySuperadmin()
  if (!userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const provider = searchParams.get('provider')

  if (!provider || !VALID_PROVIDERS.includes(provider as typeof VALID_PROVIDERS[number])) {
    return NextResponse.json({ error: 'Valid provider is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await (admin as SupabaseClient)
    .from('system_integration_configs')
    .delete()
    .eq('provider', provider)

  if (error) {
    console.error('Delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 })
  }

  invalidateCache(provider)

  return NextResponse.json({ success: true })
}

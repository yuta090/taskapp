import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { IntegrationConnection, IntegrationProvider } from './types'

let _supabaseAdmin: ReturnType<typeof createSupabaseClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 5 minutes buffer

/**
 * Refresh the token if it is about to expire.
 * Returns the refreshed connection or null if refresh is not needed/possible.
 */
export async function refreshIfNeeded(
  connectionId: string,
  refreshFn: (refreshToken: string) => Promise<{
    accessToken: string
    refreshToken?: string | null
    expiresAt: Date | null
  }>,
): Promise<IntegrationConnection | null> {
  const { data: connection, error } = await (getSupabaseAdmin() as any)
    .from('integration_connections')
    .select('*')
    .eq('id', connectionId)
    .single()

  if (error || !connection) {
    console.error('Failed to fetch connection for refresh:', error)
    return null
  }

  // Check if token is still valid (with buffer)
  if (connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at).getTime()
    const now = Date.now()
    if (expiresAt - now > TOKEN_EXPIRY_BUFFER_MS) {
      return connection as IntegrationConnection
    }
  } else {
    // No expiry set, assume valid
    return connection as IntegrationConnection
  }

  // Token is expired or about to expire — refresh
  if (!connection.refresh_token) {
    // No refresh token, mark as expired
    await (getSupabaseAdmin() as any)
      .from('integration_connections')
      .update({ status: 'expired' } as any)
      .eq('id', connectionId)
    return null
  }

  try {
    const refreshed = await refreshFn(connection.refresh_token)

    const updateData: Record<string, unknown> = {
      access_token: refreshed.accessToken,
      token_expires_at: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
      last_refreshed_at: new Date().toISOString(),
      status: 'active',
    }

    if (refreshed.refreshToken !== undefined) {
      updateData.refresh_token = refreshed.refreshToken
    }

    const { data: updated, error: updateError } = await (getSupabaseAdmin() as any)
      .from('integration_connections')
      .update(updateData as any)
      .eq('id', connectionId)
      .select('*')
      .single()

    if (updateError) {
      console.error('Failed to update refreshed token:', updateError)
      return null
    }

    return updated as IntegrationConnection
  } catch (err) {
    console.error('Token refresh failed:', err)
    await (getSupabaseAdmin() as any)
      .from('integration_connections')
      .update({ status: 'expired' } as any)
      .eq('id', connectionId)
    return null
  }
}

/**
 * Get a valid access token for the given connection.
 * Refreshes if necessary using the provided refresh function.
 */
export async function getValidToken(
  connectionId: string,
  refreshFn: (refreshToken: string) => Promise<{
    accessToken: string
    refreshToken?: string | null
    expiresAt: Date | null
  }>,
): Promise<string | null> {
  const connection = await refreshIfNeeded(connectionId, refreshFn)
  return connection?.access_token ?? null
}

/**
 * Revoke a token by marking it as revoked in the database.
 */
export async function revokeToken(connectionId: string): Promise<boolean> {
  const { error } = await (getSupabaseAdmin() as any)
    .from('integration_connections')
    .update({ status: 'revoked' } as any)
    .eq('id', connectionId)

  if (error) {
    console.error('Failed to revoke token:', error)
    return false
  }
  return true
}

/**
 * Find a connection for a given provider and owner.
 */
export async function findConnection(
  provider: IntegrationProvider,
  ownerType: 'user' | 'org',
  ownerId: string,
): Promise<IntegrationConnection | null> {
  const { data, error } = await (getSupabaseAdmin() as any)
    .from('integration_connections')
    .select('*')
    .eq('provider', provider)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('status', 'active')
    .single()

  if (error || !data) return null
  return data as IntegrationConnection
}

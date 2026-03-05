/**
 * System Integration Config — DB-backed configuration with in-memory cache.
 * Server-side only.
 *
 * Replaces per-provider environment variable lookups with a single DB table.
 * Falls back to env vars when DB config is missing (migration period).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export type IntegrationProvider = 'github' | 'slack' | 'google_calendar' | 'zoom' | 'teams'

export interface IntegrationCredentials {
  [key: string]: string
}

export interface SystemIntegrationConfig {
  provider: IntegrationProvider
  enabled: boolean
  credentials: IntegrationCredentials
  config: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// In-memory cache (per-process, TTL 5 min)
// ---------------------------------------------------------------------------
interface CacheEntry {
  data: SystemIntegrationConfig | null
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()

function getCached(provider: string): SystemIntegrationConfig | null | undefined {
  const entry = cache.get(provider)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(provider)
    return undefined
  }
  return entry.data
}

function setCache(provider: string, data: SystemIntegrationConfig | null) {
  cache.set(provider, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function invalidateCache(provider?: string) {
  if (provider) {
    cache.delete(provider)
  } else {
    cache.clear()
  }
}

// ---------------------------------------------------------------------------
// Encryption key
// ---------------------------------------------------------------------------
function getEncryptionKey(): string {
  const key = process.env.SYSTEM_ENCRYPTION_KEY
  if (!key) {
    throw new Error('SYSTEM_ENCRYPTION_KEY is not configured')
  }
  return key
}

// ---------------------------------------------------------------------------
// Core: fetch config from DB (with decryption)
// ---------------------------------------------------------------------------
async function fetchFromDb(provider: IntegrationProvider): Promise<SystemIntegrationConfig | null> {
  const admin = createAdminClient()

  const { data, error } = await (admin as SupabaseClient)
    .from('system_integration_configs')
    .select('provider, enabled, credentials_encrypted, config')
    .eq('provider', provider)
    .single()

  if (error || !data) return null

  // Decrypt credentials JSON
  const { data: decrypted, error: decryptError } = await (admin as SupabaseClient)
    .rpc('decrypt_system_secret', {
      encrypted: data.credentials_encrypted,
      secret: getEncryptionKey(),
    })

  if (decryptError || !decrypted) {
    console.error(`Failed to decrypt credentials for ${provider}:`, decryptError)
    return null
  }

  let credentials: IntegrationCredentials
  try {
    credentials = JSON.parse(decrypted as string)
  } catch {
    console.error(`Failed to parse decrypted credentials for ${provider}`)
    return null
  }

  return {
    provider: data.provider as IntegrationProvider,
    enabled: data.enabled,
    credentials,
    config: (data.config ?? {}) as Record<string, unknown>,
  }
}

// ---------------------------------------------------------------------------
// Environment variable fallbacks (migration period)
// ---------------------------------------------------------------------------
const ENV_FALLBACKS: Record<IntegrationProvider, () => SystemIntegrationConfig | null> = {
  github: () => {
    if (process.env.NEXT_PUBLIC_GITHUB_ENABLED !== 'true') return null
    return {
      provider: 'github',
      enabled: true,
      credentials: {
        app_id: process.env.GITHUB_APP_ID ?? '',
        client_id: process.env.GITHUB_APP_CLIENT_ID ?? '',
        client_secret: process.env.GITHUB_APP_CLIENT_SECRET ?? '',
        private_key: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
        webhook_secret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
      },
      config: {
        app_slug: process.env.GITHUB_APP_SLUG ?? 'taskapp',
      },
    }
  },
  slack: () => {
    if (process.env.NEXT_PUBLIC_SLACK_ENABLED !== 'true') return null
    return {
      provider: 'slack',
      enabled: true,
      credentials: {
        client_id: process.env.SLACK_CLIENT_ID ?? '',
        client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
        signing_secret: process.env.SLACK_SIGNING_SECRET ?? '',
        state_secret: process.env.SLACK_STATE_SECRET ?? '',
      },
      config: {},
    }
  },
  google_calendar: () => {
    if (process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED !== 'true') return null
    return {
      provider: 'google_calendar',
      enabled: true,
      credentials: {
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        state_secret: process.env.GOOGLE_STATE_SECRET ?? '',
      },
      config: {},
    }
  },
  zoom: () => {
    if (process.env.NEXT_PUBLIC_ZOOM_ENABLED !== 'true') return null
    return {
      provider: 'zoom',
      enabled: true,
      credentials: {
        client_id: process.env.ZOOM_CLIENT_ID ?? '',
        client_secret: process.env.ZOOM_CLIENT_SECRET ?? '',
        account_id: process.env.ZOOM_ACCOUNT_ID ?? '',
      },
      config: {
        redirect_uri: process.env.ZOOM_REDIRECT_URI ?? '',
      },
    }
  },
  teams: () => {
    if (process.env.NEXT_PUBLIC_TEAMS_ENABLED !== 'true') return null
    return {
      provider: 'teams',
      enabled: true,
      credentials: {
        client_id: process.env.MS_CLIENT_ID ?? '',
        client_secret: process.env.MS_CLIENT_SECRET ?? '',
        tenant_id: process.env.MS_TENANT_ID ?? '',
      },
      config: {
        redirect_uri: process.env.MS_REDIRECT_URI ?? '',
      },
    }
  },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get integration config for a provider.
 * Tries DB first, falls back to environment variables.
 */
export async function getIntegrationConfig(
  provider: IntegrationProvider,
): Promise<SystemIntegrationConfig | null> {
  // 1. Check cache
  const cached = getCached(provider)
  if (cached !== undefined) return cached

  // 2. Try DB
  try {
    const dbConfig = await fetchFromDb(provider)
    if (dbConfig) {
      setCache(provider, dbConfig)
      return dbConfig
    }
  } catch {
    // DB not available or table doesn't exist yet — fall through to env
  }

  // 3. Fallback to env vars
  const envConfig = ENV_FALLBACKS[provider]()
  setCache(provider, envConfig)
  return envConfig
}

/**
 * Check if a provider is enabled (fast, cached).
 */
export async function isIntegrationEnabled(provider: IntegrationProvider): Promise<boolean> {
  const config = await getIntegrationConfig(provider)
  return config?.enabled ?? false
}

/**
 * Get all enabled providers (for the status endpoint).
 */
export async function getAllIntegrationStatus(): Promise<Record<IntegrationProvider, boolean>> {
  const providers: IntegrationProvider[] = ['github', 'slack', 'google_calendar', 'zoom', 'teams']
  const results = await Promise.all(
    providers.map(async (p) => [p, await isIntegrationEnabled(p)] as const),
  )
  return Object.fromEntries(results) as Record<IntegrationProvider, boolean>
}

// Integration connection types for unified OAuth provider management

export type IntegrationProvider = 'google_calendar' | 'zoom' | 'google_meet' | 'teams'

export type ConnectionOwnerType = 'user' | 'org'

export type ConnectionStatus = 'active' | 'expired' | 'revoked'

export interface IntegrationConnection {
  id: string
  provider: IntegrationProvider
  owner_type: ConnectionOwnerType
  owner_id: string
  org_id: string
  access_token: string
  refresh_token: string | null
  token_expires_at: string | null
  scopes: string | null
  metadata: Record<string, unknown>
  status: ConnectionStatus
  last_refreshed_at: string | null
  created_at: string
  updated_at: string
}

/** Client-safe connection info (tokens excluded) for use in frontend hooks/components */
export type IntegrationConnectionSafe = Omit<IntegrationConnection, 'access_token' | 'refresh_token'>

export interface OAuthStartParams {
  provider: IntegrationProvider
  orgId: string
  userId: string
  redirectPath?: string
}

export interface OAuthCallbackParams {
  provider: IntegrationProvider
  code: string
  state: string
}

export interface TokenInfo {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scopes: string | null
}

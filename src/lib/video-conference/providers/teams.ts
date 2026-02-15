import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { refreshTeamsToken } from '@/lib/teams/client'
import type {
  VideoConferenceProvider,
  CreateMeetingParams,
  VideoMeetingResult,
} from '../types'

const MS_OAUTH_URL = 'https://login.microsoftonline.com'
const MS_GRAPH_URL = 'https://graph.microsoft.com/v1.0'

/**
 * Microsoft Teams プロバイダー
 *
 * ユーザーレベルOAuth接続があればそちらを優先し（/me エンドポイント使用）、
 * なければ Client Credentials flow (org-level) にフォールバック。
 *
 * 環境変数 (Client Credentials):
 * - MS_CLIENT_ID
 * - MS_CLIENT_SECRET
 * - MS_TENANT_ID
 * - MS_ORGANIZER_USER_ID (Client Credentials flow 時のみ必要)
 */
export class TeamsProvider implements VideoConferenceProvider {
  readonly name = 'teams' as const

  private cachedToken: { token: string; expiresAt: number } | null = null

  isConfigured(): boolean {
    return (
      process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true' &&
      !!process.env.MS_CLIENT_ID &&
      !!process.env.MS_CLIENT_SECRET &&
      !!process.env.MS_TENANT_ID
    )
  }

  private isClientCredentialsConfigured(): boolean {
    return (
      !!process.env.MS_CLIENT_ID &&
      !!process.env.MS_CLIENT_SECRET &&
      !!process.env.MS_TENANT_ID &&
      !!process.env.MS_ORGANIZER_USER_ID
    )
  }

  async isUserConnected(userId: string): Promise<boolean> {
    const userToken = await this.getUserAccessToken(userId)
    if (userToken) return true
    return this.isClientCredentialsConfigured()
  }

  /**
   * ユーザーのintegration_connectionからアクセストークンを取得。
   * 期限切れの場合はリフレッシュしてDB更新。
   */
  private async getUserAccessToken(userId: string): Promise<string | null> {
    try {
      const supabaseAdmin = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )

      const { data: conn } = await supabaseAdmin
        .from('integration_connections')
        .select('*')
        .eq('provider', 'teams')
        .eq('owner_type', 'user')
        .eq('owner_id', userId)
        .eq('status', 'active')
        .single()

      if (!conn) return null

      // トークンの有効期限を確認（1分の余裕）
      const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
      if (Date.now() < expiresAt - 60_000) {
        return conn.access_token
      }

      // リフレッシュが必要
      if (!conn.refresh_token) return null

      const refreshed = await refreshTeamsToken(conn.refresh_token)

      await supabaseAdmin
        .from('integration_connections')
        .update({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken ?? conn.refresh_token,
          token_expires_at: refreshed.expiresAt.toISOString(),
          last_refreshed_at: new Date().toISOString(),
        })
        .eq('id', conn.id)

      return refreshed.accessToken
    } catch (err) {
      console.error('Failed to get user Teams token:', err)
      return null
    }
  }

  private async getClientCredentialsToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token
    }

    const tenantId = process.env.MS_TENANT_ID!
    const clientId = process.env.MS_CLIENT_ID!
    const clientSecret = process.env.MS_CLIENT_SECRET!

    const response = await fetch(`${MS_OAUTH_URL}/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('MS OAuth token request failed:', response.status, errorBody)
      throw new Error(`MS OAuth token request failed (${response.status})`)
    }

    const data = await response.json()

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }

    return data.access_token
  }

  /**
   * アクセストークンを取得。ユーザーOAuth → Client Credentials の優先順位。
   * useUserFlow が true の場合、ユーザートークンが使われたことを示す。
   */
  private async getAccessToken(userId?: string): Promise<{ token: string; useUserFlow: boolean }> {
    if (userId) {
      const userToken = await this.getUserAccessToken(userId)
      if (userToken) return { token: userToken, useUserFlow: true }
    }

    if (this.isClientCredentialsConfigured()) {
      return { token: await this.getClientCredentialsToken(), useUserFlow: false }
    }

    throw new Error('Teams is not configured: no user OAuth token and Client Credentials is not available')
  }

  async createMeeting(params: CreateMeetingParams): Promise<VideoMeetingResult> {
    const { token: accessToken, useUserFlow } = await this.getAccessToken(params.createdByUserId)

    const meetingPayload = {
      subject: params.title,
      startDateTime: params.startAt,
      endDateTime: params.endAt,
      participants: {
        attendees: params.participants.map((p) => ({
          upn: p.email,
          identity: {
            user: {
              displayName: p.name,
            },
          },
        })),
      },
    }

    // ユーザーOAuthなら /me、Client Credentialsなら /users/{id}
    let endpoint: string
    if (useUserFlow) {
      endpoint = `${MS_GRAPH_URL}/me/onlineMeetings`
    } else {
      const organizerUserId = process.env.MS_ORGANIZER_USER_ID
      if (!organizerUserId) {
        throw new Error('MS_ORGANIZER_USER_ID is required for Teams client credentials flow')
      }
      endpoint = `${MS_GRAPH_URL}/users/${encodeURIComponent(organizerUserId)}/onlineMeetings`
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meetingPayload),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Microsoft Graph API error (Teams meeting):', response.status, errorBody)
      throw new Error(`Microsoft Graph API error (${response.status})`)
    }

    const data = await response.json()

    return {
      meetingUrl: data.joinWebUrl || data.joinUrl,
      externalMeetingId: data.id,
      dialIn: data.audioConferencing?.tollNumber
        ? `${data.audioConferencing.tollNumber} (ID: ${data.audioConferencing.conferenceId})`
        : undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancelMeeting(externalMeetingId: string, _createdByUserId?: string): Promise<void> {
    // cancelMeeting はユーザーコンテキスト不明のため、Client Credentialsを使用
    if (!this.isClientCredentialsConfigured()) {
      console.error('Teams Client Credentials not configured for meeting cancellation')
      return
    }

    const accessToken = await this.getClientCredentialsToken()

    const organizerUserId = process.env.MS_ORGANIZER_USER_ID!

    const response = await fetch(
      `${MS_GRAPH_URL}/users/${encodeURIComponent(organizerUserId)}/onlineMeetings/${encodeURIComponent(externalMeetingId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )

    if (!response.ok && response.status !== 404) {
      const errorBody = await response.text()
      console.error(`Failed to cancel Teams meeting: ${response.status} ${errorBody}`)
    }
  }
}

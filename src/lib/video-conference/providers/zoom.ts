import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { refreshZoomToken } from '@/lib/zoom/client'
import type {
  VideoConferenceProvider,
  CreateMeetingParams,
  VideoMeetingResult,
} from '../types'

const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token'
const ZOOM_API_URL = 'https://api.zoom.us/v2'

/**
 * Zoom プロバイダー
 *
 * ユーザーレベルOAuth接続があればそちらを優先し、
 * なければ Server-to-Server OAuth (Account Credentials) にフォールバック。
 *
 * 環境変数 (S2S):
 * - ZOOM_CLIENT_ID
 * - ZOOM_CLIENT_SECRET
 * - ZOOM_ACCOUNT_ID
 */
export class ZoomProvider implements VideoConferenceProvider {
  readonly name = 'zoom' as const

  private cachedToken: { token: string; expiresAt: number } | null = null

  isConfigured(): boolean {
    return (
      process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true' &&
      !!process.env.ZOOM_CLIENT_ID &&
      !!process.env.ZOOM_CLIENT_SECRET
    )
  }

  private isS2SConfigured(): boolean {
    return (
      !!process.env.ZOOM_CLIENT_ID &&
      !!process.env.ZOOM_CLIENT_SECRET &&
      !!process.env.ZOOM_ACCOUNT_ID
    )
  }

  async isUserConnected(userId: string): Promise<boolean> {
    const userToken = await this.getUserAccessToken(userId)
    if (userToken) return true
    return this.isS2SConfigured()
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
        .eq('provider', 'zoom')
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

      const refreshed = await refreshZoomToken(conn.refresh_token)

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
      console.error('Failed to get user Zoom token:', err)
      return null
    }
  }

  private async getS2SAccessToken(): Promise<string> {
    // キャッシュされたトークンが有効であればそのまま返す
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token
    }

    const clientId = process.env.ZOOM_CLIENT_ID!
    const clientSecret = process.env.ZOOM_CLIENT_SECRET!
    const accountId = process.env.ZOOM_ACCOUNT_ID!

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const response = await fetch(ZOOM_OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'account_credentials',
        account_id: accountId,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Zoom OAuth token request failed:', response.status, errorBody)
      throw new Error(`Zoom OAuth token request failed (${response.status})`)
    }

    const data = await response.json()

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }

    return data.access_token
  }

  /**
   * アクセストークンを取得。ユーザーOAuth → S2S の優先順位。
   */
  private async getAccessToken(userId?: string): Promise<string> {
    if (userId) {
      const userToken = await this.getUserAccessToken(userId)
      if (userToken) return userToken
    }

    if (this.isS2SConfigured()) {
      return this.getS2SAccessToken()
    }

    throw new Error('Zoom is not configured: no user OAuth token and S2S is not available')
  }

  async createMeeting(params: CreateMeetingParams): Promise<VideoMeetingResult> {
    const accessToken = await this.getAccessToken(params.createdByUserId)

    const meetingPayload = {
      topic: params.title,
      type: 2, // Scheduled meeting
      start_time: params.startAt,
      duration: Math.round(
        (new Date(params.endAt).getTime() - new Date(params.startAt).getTime()) / 60_000,
      ),
      timezone: 'Asia/Tokyo',
      agenda: params.description || '',
      settings: {
        join_before_host: true,
        waiting_room: false,
        auto_recording: 'none',
        meeting_invitees: params.participants.map((p) => ({ email: p.email })),
      },
    }

    const response = await fetch(`${ZOOM_API_URL}/users/me/meetings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meetingPayload),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Zoom meeting creation failed:', response.status, errorBody)
      throw new Error(`Zoom API error (${response.status})`)
    }

    const data = await response.json()

    return {
      meetingUrl: data.join_url,
      externalMeetingId: String(data.id),
      hostUrl: data.start_url,
      dialIn: data.pstn_password ? `${data.pstn_password}` : undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancelMeeting(externalMeetingId: string, _createdByUserId?: string): Promise<void> {
    const accessToken = await this.getAccessToken()

    const response = await fetch(
      `${ZOOM_API_URL}/meetings/${encodeURIComponent(externalMeetingId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )

    if (!response.ok && response.status !== 404) {
      const errorBody = await response.text()
      console.error(`Failed to cancel Zoom meeting: ${response.status} ${errorBody}`)
    }
  }
}

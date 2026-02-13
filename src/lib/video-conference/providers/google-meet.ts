import { findConnection } from '@/lib/integrations/token-manager'
import { getValidToken } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import type {
  VideoConferenceProvider,
  CreateMeetingParams,
  VideoMeetingResult,
} from '../types'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

/**
 * Google Meet プロバイダー
 *
 * Phase 2 の Google Calendar OAuth トークンを再利用。
 * Calendar Events API で conferenceData 付きイベントを作成し、
 * Google Meet リンクを自動生成する。
 *
 * 必要スコープ: calendar.events (Phase 2 の calendar.freebusy に追加)
 */
export class GoogleMeetProvider implements VideoConferenceProvider {
  readonly name = 'google_meet' as const

  isConfigured(): boolean {
    return process.env.NEXT_PUBLIC_GOOGLE_MEET_ENABLED === 'true'
      && process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED === 'true'
  }

  async isUserConnected(userId: string): Promise<boolean> {
    const connection = await findConnection('google_calendar', 'user', userId)
    return connection !== null
  }

  async createMeeting(params: CreateMeetingParams): Promise<VideoMeetingResult> {
    if (!params.createdByUserId) {
      throw new Error('Google Meet requires createdByUserId to use the user\'s Calendar connection')
    }

    const connection = await findConnection('google_calendar', 'user', params.createdByUserId)
    if (!connection) {
      throw new Error('Google Calendar connection not found for user')
    }

    const accessToken = await getValidToken(connection.id, refreshAccessToken)
    if (!accessToken) {
      throw new Error('Failed to obtain valid Google access token')
    }

    const event = {
      summary: params.title,
      description: params.description || '',
      start: {
        dateTime: params.startAt,
      },
      end: {
        dateTime: params.endAt,
      },
      attendees: params.participants.map((p) => ({
        email: p.email,
        displayName: p.name,
      })),
      conferenceData: {
        createRequest: {
          requestId: params.idempotencyKey,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    }

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    )

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Google Calendar API error (Meet creation):', response.status, errorBody)
      throw new Error(`Google Calendar API error (${response.status})`)
    }

    const data = await response.json()
    const meetingUrl = data.conferenceData?.entryPoints?.find(
      (ep: { entryPointType: string; uri: string }) => ep.entryPointType === 'video',
    )?.uri

    const dialIn = data.conferenceData?.entryPoints?.find(
      (ep: { entryPointType: string; uri: string }) => ep.entryPointType === 'phone',
    )?.uri

    if (!meetingUrl) {
      throw new Error('Google Meet URL not returned from Calendar API')
    }

    return {
      meetingUrl,
      externalMeetingId: data.id,
      dialIn: dialIn || undefined,
    }
  }

  async cancelMeeting(externalMeetingId: string, createdByUserId?: string): Promise<void> {
    if (!createdByUserId) {
      console.error('Google Meet cancelMeeting requires createdByUserId')
      return
    }

    const connection = await findConnection('google_calendar', 'user', createdByUserId)
    if (!connection) {
      console.error('Google Calendar connection not found for cancellation')
      return
    }

    const accessToken = await getValidToken(connection.id, refreshAccessToken)
    if (!accessToken) {
      console.error('Failed to obtain valid Google access token for cancellation')
      return
    }

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(externalMeetingId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )

    if (!response.ok && response.status !== 410) {
      const errorBody = await response.text()
      console.error(`Failed to cancel Google Calendar event: ${response.status} ${errorBody}`)
    }
  }
}

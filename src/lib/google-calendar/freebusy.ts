import { GoogleCalendarClient } from './client'

export interface FreeBusyParams {
  timeMin: string  // ISO 8601 timestamptz
  timeMax: string  // ISO 8601 timestamptz
  calendarIds: string[]  // calendar IDs (typically 'primary' for the user's main calendar)
}

export interface FreeBusySlot {
  start: string
  end: string
}

export interface FreeBusyResult {
  calendars: Record<string, {
    busy: FreeBusySlot[]
    errors?: Array<{ domain: string; reason: string }>
  }>
}

/**
 * Google Calendar Free/Busy API に問い合わせ
 * 指定した時間範囲内のカレンダーの空き/埋まり状況を取得
 */
export async function queryFreeBusy(
  accessToken: string,
  params: FreeBusyParams,
): Promise<FreeBusyResult> {
  const client = new GoogleCalendarClient(accessToken)

  const result = await client.queryFreeBusy({
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    items: params.calendarIds.map(id => ({ id })),
  })

  return {
    calendars: result.calendars,
  }
}

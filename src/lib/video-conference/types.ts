// ビデオ会議プロバイダー抽象化 — Zoom, Google Meet, Teams を統一的に扱う

export type VideoConferenceProviderName = 'zoom' | 'google_meet' | 'teams'

export interface CreateMeetingParams {
  title: string
  startAt: string // ISO timestamptz (UTC)
  endAt: string
  participants: Array<{ email: string; name: string }>
  description?: string
  idempotencyKey: string // 二重作成防止
  createdByUserId?: string // 作成者のユーザーID（Google Meet等ユーザーOAuth接続が必要な場合）
}

export interface VideoMeetingResult {
  meetingUrl: string
  externalMeetingId: string
  hostUrl?: string
  dialIn?: string
}

export interface VideoConferenceProvider {
  readonly name: VideoConferenceProviderName
  isConfigured(): boolean
  isUserConnected(userId: string): Promise<boolean>
  createMeeting(params: CreateMeetingParams): Promise<VideoMeetingResult>
  cancelMeeting(externalMeetingId: string, createdByUserId?: string): Promise<void>
}

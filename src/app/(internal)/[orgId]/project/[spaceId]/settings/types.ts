export type SettingSectionId =
  | 'general'
  | 'milestones'
  | 'members'
  | 'github'
  | 'slack'
  | 'google-calendar'
  | 'video-conference'
  | 'ai'
  | 'api'
  | 'export'

export type ConnectionStatus = 'connected' | 'disconnected' | 'warning' | 'none'

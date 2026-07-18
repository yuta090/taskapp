import { describe, it, expect, beforeEach } from 'vitest'
import {
  getGoogleTasksOAuthUrl,
  getGoogleTasksRedirectUri,
  isGoogleTasksOAuthConfigured,
  GOOGLE_TASKS_SCOPES,
} from '@/lib/google-tasks/config'

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('google-tasks config', () => {
  it('scope は tasks フルスコープ(逆流+順方向書き込みに必要)', () => {
    expect(GOOGLE_TASKS_SCOPES).toEqual(['https://www.googleapis.com/auth/tasks'])
  })

  it('redirect uri は google_tasks コールバック', () => {
    expect(getGoogleTasksRedirectUri()).toBe('https://app.example.com/api/integrations/callback/google_tasks')
  })

  it('OAuth URL に scope/access_type=offline/prompt=consent/state が載る', () => {
    const url = getGoogleTasksOAuthUrl('state-123')
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Ftasks')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('prompt=consent')
    expect(url).toContain('state=state-123')
  })

  it('client id/secret が揃っていれば configured(既存google-sheetsと同じくロード時のenvを見る)', () => {
    expect(isGoogleTasksOAuthConfigured()).toBe(true)
  })
})

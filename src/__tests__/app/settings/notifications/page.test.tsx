import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NotificationSettingsPage from '@/app/settings/notifications/page'

const updateMock = vi.fn(() => Promise.resolve())
let prefs = {
  email_enabled: true,
  on_task_assigned: true,
  on_task_mentioned: true,
  on_review_request: true,
  on_client_response: true,
  on_meeting_reminder: true,
  digest_frequency: 'daily' as const,
}
let pushSupported = true
let userLoading = false
let currentUser: { id: string } | null = { id: 'user-1' }
let prefsLoading = false
const readPushEnvironmentMock = vi.fn(() => 'supported' as string)

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, loading: userLoading }),
}))
vi.mock('@/lib/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    isSupported: pushSupported,
    permission: 'default',
    isSubscribed: false,
    loading: false,
    error: null,
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/useNotificationEmailPrefs', () => ({
  useNotificationEmailPrefs: () => ({ prefs, update: updateMock, saving: false, loading: prefsLoading }),
}))
vi.mock('@/lib/hooks/useDueReminderPreference', () => ({
  useDueReminderPreference: () => ({ enabled: true, toggle: vi.fn(), saving: false, loading: false }),
}))
vi.mock('@/lib/push/environment', () => ({
  readPushEnvironment: () => readPushEnvironmentMock(),
}))

describe('通知設定ページ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSupported = true
    userLoading = false
    currentUser = { id: 'user-1' }
    prefsLoading = false
    readPushEnvironmentMock.mockReturnValue('supported')
    prefs = {
      email_enabled: true,
      on_task_assigned: true,
      on_task_mentioned: true,
      on_review_request: true,
      on_client_response: true,
      on_meeting_reminder: true,
      digest_frequency: 'daily',
    }
  })

  it('急ぎのものはすぐ届く、と正しく案内する', () => {
    render(<NotificationSettingsPage />)
    expect(screen.getByText(/急ぎのものだけすぐ/)).toBeInTheDocument()
    // ブラウザ通知カードと、メールの案内の2か所に書いてある
    expect(screen.getAllByText(/夜9時〜朝8時と土日は/).length).toBeGreaterThanOrEqual(2)
  })

  it('種類の設定は、メールとブラウザ通知の共通だと書いてある', () => {
    render(<NotificationSettingsPage />)
    expect(screen.getByText('通知の種類')).toBeInTheDocument()
    expect(screen.getByText(/メールとブラウザ通知の両方に効きます/)).toBeInTheDocument()
  })

  it('メールを止めていても、種類のスイッチは操作できる(ブラウザ通知にも効くため)', () => {
    prefs = { ...prefs, email_enabled: false }
    render(<NotificationSettingsPage />)

    const toggle = screen.getByRole('switch', { name: '社内承認依頼' })
    expect(toggle).not.toBeDisabled()

    fireEvent.click(toggle)
    expect(updateMock).toHaveBeenCalledWith({ on_review_request: false })
  })

  it('iPhoneには「ホーム画面に追加」を案内する', () => {
    pushSupported = false
    readPushEnvironmentMock.mockReturnValue('ios_needs_home_screen')
    render(<NotificationSettingsPage />)

    expect(screen.getByText(/ホーム画面に追加してください/)).toBeInTheDocument()
    expect(screen.queryByText(/このブラウザはプッシュ通知に対応していません/)).not.toBeInTheDocument()
  })

  it('本当に非対応のブラウザにはそう伝える', () => {
    pushSupported = false
    readPushEnvironmentMock.mockReturnValue('unsupported')
    render(<NotificationSettingsPage />)

    expect(screen.getByText(/このブラウザはプッシュ通知に対応していません/)).toBeInTheDocument()
    expect(screen.queryByText(/ホーム画面に追加してください/)).not.toBeInTheDocument()
  })
})

describe('通知設定ページ — 読み込み中の見え方', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSupported = true
    userLoading = false
    currentUser = { id: 'user-1' }
    prefsLoading = false
    readPushEnvironmentMock.mockReturnValue('supported')
    prefs = {
      email_enabled: true,
      on_task_assigned: true,
      on_task_mentioned: true,
      on_review_request: true,
      on_client_response: true,
      on_meeting_reminder: true,
      digest_frequency: 'daily',
    }
  })

  it('読み込み中でも枠は出す(全画面スピナーで白くしない)', () => {
    userLoading = true
    currentUser = null
    render(<NotificationSettingsPage />)

    expect(screen.getByText('通知設定')).toBeInTheDocument()
    expect(screen.getByTestId('notification-settings-skeleton')).toBeInTheDocument()
  })

  it('受信設定が来るまで、種類のスイッチは骨組みにする(既定値でパタつかせない)', () => {
    prefsLoading = true
    render(<NotificationSettingsPage />)

    expect(screen.getByTestId('notification-types-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '社内承認依頼' })).not.toBeInTheDocument()
  })

  it('未ログインならログイン導線を出す(枠は残す)', () => {
    currentUser = null
    render(<NotificationSettingsPage />)

    expect(screen.getByText('通知設定')).toBeInTheDocument()
    expect(screen.getByText('ログインが必要です')).toBeInTheDocument()
  })
})

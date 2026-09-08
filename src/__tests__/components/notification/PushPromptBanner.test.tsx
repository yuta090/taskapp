import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PushPromptBanner } from '@/components/notification/PushPromptBanner'

const enableMock = vi.fn(() => Promise.resolve())
const usePushMock = vi.fn(() => ({
  isSupported: true,
  permission: 'default' as const,
  isSubscribed: false,
  loading: false,
  error: null as string | null,
  enable: enableMock,
  disable: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/hooks/usePushNotifications', () => ({
  usePushNotifications: () => usePushMock(),
}))

const readPushEnvironmentMock = vi.fn(() => 'supported' as string)
vi.mock('@/lib/push/environment', () => ({
  readPushEnvironment: () => readPushEnvironmentMock(),
}))

function setPermission(permission: string) {
  // jsdom には Notification が無いので必要なぶんだけ生やす
  Object.defineProperty(globalThis, 'Notification', {
    value: { permission },
    configurable: true,
    writable: true,
  })
}

describe('PushPromptBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    readPushEnvironmentMock.mockReturnValue('supported')
    setPermission('default')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('まだ可否を答えていない人には出る', async () => {
    render(<PushPromptBanner />)
    expect(await screen.findByTestId('push-prompt-banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通知を受け取る' })).toBeInTheDocument()
  })

  it('「通知を受け取る」で購読を開始する', async () => {
    render(<PushPromptBanner />)
    fireEvent.click(await screen.findByRole('button', { name: '通知を受け取る' }))
    expect(enableMock).toHaveBeenCalledTimes(1)
  })

  it('「あとで」を押すと消え、次に開いても出ない', async () => {
    const { unmount } = render(<PushPromptBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'あとで' }))
    await waitFor(() => expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument())
    unmount()

    render(<PushPromptBanner />)
    await waitFor(() => expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument())
  })

  it('すでに許可済みの人には出さない', async () => {
    setPermission('granted')
    render(<PushPromptBanner />)
    await waitFor(() => expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument())
  })

  it('一度断った人に聞き直さない', async () => {
    setPermission('denied')
    render(<PushPromptBanner />)
    await waitFor(() => expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument())
  })

  it('通知を扱えない環境では出さない', async () => {
    readPushEnvironmentMock.mockReturnValue('ios_needs_home_screen')
    render(<PushPromptBanner />)
    await waitFor(() => expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument())
  })

  it('出さないと決めた人には、通知まわりの初期化(service worker登録)を走らせない', async () => {
    setPermission('granted')
    render(<PushPromptBanner />)
    await waitFor(() => expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument())
    expect(usePushMock).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsBackButton } from '@/components/shared/SettingsBackButton'

const mockPush = vi.fn()
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))

function setHistoryLength(length: number) {
  Object.defineProperty(window.history, 'length', {
    value: length,
    configurable: true,
  })
}

describe('SettingsBackButton', () => {
  const originalHistoryLength = window.history.length

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    setHistoryLength(originalHistoryLength)
  })

  it('navigates back via router.back() when browser history exists', () => {
    setHistoryLength(2)
    render(<SettingsBackButton />)

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('falls back to /inbox when there is no browser history', () => {
    setHistoryLength(1)
    render(<SettingsBackButton />)

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(mockPush).toHaveBeenCalledWith('/inbox')
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('falls back to a custom fallbackHref when provided', () => {
    setHistoryLength(1)
    render(<SettingsBackButton fallbackHref="/settings/account" />)

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(mockPush).toHaveBeenCalledWith('/settings/account')
  })
})

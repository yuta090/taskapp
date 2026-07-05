import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PortalRequestSheet } from '@/components/portal/PortalRequestSheet'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

function fillFeatureRequest() {
  fireEvent.change(screen.getByLabelText(/タイトル/), { target: { value: 'CSV出力機能がほしい' } })
  fireEvent.change(screen.getByLabelText(/ほしい機能の内容/), {
    target: { value: '月次報告用にCSVダウンロードしたい' },
  })
}

describe('PortalRequestSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('shows an error toast and keeps the sheet open with input preserved when submission fails (e.g. 500)', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'リクエストの送信に失敗しました' }),
    })
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(<PortalRequestSheet isOpen onClose={onClose} onSuccess={onSuccess} />)
    fillFeatureRequest()
    fireEvent.click(screen.getByRole('button', { name: '送信する' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('リクエストの送信に失敗しました')
    })

    // Dialog stays open and input is preserved (no data loss for the user)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/タイトル/)).toHaveValue('CSV出力機能がほしい')
    expect(screen.getByLabelText(/ほしい機能の内容/)).toHaveValue('月次報告用にCSVダウンロードしたい')
  })

  it('shows a success toast, resets the form, and closes the sheet when submission succeeds', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, taskId: 'task-1' }),
    })
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(<PortalRequestSheet isOpen onClose={onClose} onSuccess={onSuccess} />)
    fillFeatureRequest()
    fireEvent.click(screen.getByRole('button', { name: '送信する' }))

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('リクエストを送信しました')
    })
    expect(onClose).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalled()
  })
})

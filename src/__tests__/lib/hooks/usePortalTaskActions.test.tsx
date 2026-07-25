import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePortalTaskActions } from '@/lib/hooks/usePortalTaskActions'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
}))

const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))

function mockFetchOnce(init: { ok: boolean; status?: number; body?: unknown }) {
  ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 400),
    json: async () => init.body ?? {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
})

describe('usePortalTaskActions', () => {
  it('approve は正しい action/body で POST し、成功で状態が done になり onActionStart が呼ばれる', async () => {
    mockFetchOnce({ ok: true })
    const onActionStart = vi.fn()
    const { result } = renderHook(() => usePortalTaskActions({ onActionStart }))

    await act(async () => {
      await result.current.handleApprove('task-1', 'いいですね')
    })

    expect(onActionStart).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/portal/tasks/task-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'approve', comment: 'いいですね' }),
      })
    )
    await waitFor(() => expect(result.current.taskStates.get('task-1')).toBe('done'))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('request_changes も専用 action で送られる', async () => {
    mockFetchOnce({ ok: true })
    const { result } = renderHook(() => usePortalTaskActions())

    await act(async () => {
      await result.current.handleRequestChanges('task-2', '直してほしい点')
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/portal/tasks/task-2',
      expect.objectContaining({
        body: JSON.stringify({ action: 'request_changes', comment: '直してほしい点' }),
      })
    )
  })

  it('409 では状態を巻き戻し、競合の toast を出す', async () => {
    mockFetchOnce({ ok: false, status: 409 })
    const { result } = renderHook(() => usePortalTaskActions())

    await act(async () => {
      await result.current.handleApprove('task-3', '')
    })

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('状態が変更されました')
    )
    // 巻き戻しで processing/done が残らない
    expect(result.current.taskStates.get('task-3')).toBeUndefined()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('estimate 系も対応する action 名で送られる', async () => {
    mockFetchOnce({ ok: true })
    const { result } = renderHook(() => usePortalTaskActions())

    await act(async () => {
      await result.current.handleEstimateReject('task-4', '高い')
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/portal/tasks/task-4',
      expect.objectContaining({
        body: JSON.stringify({ action: 'estimate_reject', comment: '高い' }),
      })
    )
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSinkDeliveries, useRedeliverDelivery, type DeliveryLogEntry } from '@/lib/hooks/useSinkDeliveries'

/** useSinkDeliveries — GET /api/integrations/deliveries のページング取得＋個別再送 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const DELIVERY: DeliveryLogEntry = {
  id: 'd-1',
  sinkId: 'sink-1',
  digestTaskId: 'task-1',
  eventType: 'task.created',
  eventKey: 'task.created:task-1:evt-1',
  status: 'dead',
  attempts: 6,
  nextAttemptAt: '2026-07-11T00:00:00.000Z',
  lastError: 'timeout',
  responseStatus: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  deliveredAt: null,
}

describe('useSinkDeliveries', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('sinkIdが未指定なら取得しない(sink未選択状態)', async () => {
    const { result } = renderHook(() => useSinkDeliveries('org-1', null), { wrapper: createWrapper() })
    expect(result.current.isLoading).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.deliveries).toEqual([])
  })

  it('orgId/sinkId/limitをクエリパラメータで渡す', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ deliveries: [DELIVERY] }) })

    const { result } = renderHook(() => useSinkDeliveries('org-1', 'sink-1', 30), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.deliveries).toEqual([DELIVERY])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/deliveries?orgId=org-1&limit=30&sinkId=sink-1',
    )
  })

  it('limitを増やして再取得すると(load more)最新のlimit件を返す', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ deliveries: [DELIVERY] }) })
    const { result, rerender } = renderHook(({ limit }) => useSinkDeliveries('org-1', 'sink-1', limit), {
      wrapper: createWrapper(),
      initialProps: { limit: 30 },
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deliveries: [DELIVERY, { ...DELIVERY, id: 'd-2' }] }),
    })
    rerender({ limit: 60 })

    await waitFor(() => expect(result.current.deliveries).toHaveLength(2))
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/integrations/deliveries?orgId=org-1&limit=60&sinkId=sink-1',
    )
  })

  it('取得失敗時はエラーメッセージを返す', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid sinkId' }) })
    const { result } = renderHook(() => useSinkDeliveries('org-1', 'sink-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('invalid sinkId')
  })
})

describe('useRedeliverDelivery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST /deliveries/[id]/redeliver を呼ぶ', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const { result } = renderHook(() => useRedeliverDelivery(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync('d-1')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/deliveries/d-1/redeliver', { method: 'POST' })
  })

  it('409(再送対象でない)の場合はエラーメッセージを投げる', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'delivery is not dead/failed (nothing to redeliver)' }),
    })
    const { result } = renderHook(() => useRedeliverDelivery(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.mutateAsync('d-1')
      }),
    ).rejects.toThrow('delivery is not dead/failed')
  })
})

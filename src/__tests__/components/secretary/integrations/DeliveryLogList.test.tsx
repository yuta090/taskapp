import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DeliveryLogList } from '@/components/secretary/integrations/DeliveryLogList'
import type { DeliveryLogEntry } from '@/lib/hooks/useSinkDeliveries'

/**
 * DeliveryLogList — 配達ログ（直近N件・もっと見る）＋個別/一括再送。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4: dead/failedに再送ボタン、sink単位の一括再送。
 */

const {
  useSinkDeliveriesMock,
  useRedeliverDeliveryMutateAsyncMock,
  useRedeliverSinkMutateAsyncMock,
  refetchMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useSinkDeliveriesMock: vi.fn(),
  useRedeliverDeliveryMutateAsyncMock: vi.fn(),
  useRedeliverSinkMutateAsyncMock: vi.fn(),
  refetchMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useSinkDeliveries', () => ({
  useSinkDeliveries: (...args: unknown[]) => useSinkDeliveriesMock(...args),
  useRedeliverDelivery: () => ({ mutateAsync: useRedeliverDeliveryMutateAsyncMock, isPending: false }),
}))
vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return {
    ...actual,
    useRedeliverSink: () => ({ mutateAsync: useRedeliverSinkMutateAsyncMock, isPending: false }),
  }
})

vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }))

function delivery(overrides: Partial<DeliveryLogEntry> = {}): DeliveryLogEntry {
  return {
    id: 'd-1',
    sinkId: 'sink-1',
    digestTaskId: 'task-1',
    eventType: 'task.created',
    eventKey: 'k1',
    status: 'sent',
    attempts: 1,
    nextAttemptAt: '2026-07-11T00:00:00.000Z',
    lastError: null,
    responseStatus: 200,
    createdAt: '2026-07-11T00:00:00.000Z',
    deliveredAt: '2026-07-11T00:00:05.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useSinkDeliveriesMock.mockReturnValue({ deliveries: [], isLoading: false, error: null, refetch: refetchMock })
})

describe('DeliveryLogList', () => {
  it('配達が無ければ空状態を表示する', () => {
    render(<DeliveryLogList orgId="org-1" sinkId="sink-1" canManage={true} />)
    expect(screen.getByText(/配達履歴がありません/)).toBeInTheDocument()
  })

  it('配達ごとにstatus/event/エラーを表示する', () => {
    useSinkDeliveriesMock.mockReturnValue({
      deliveries: [delivery(), delivery({ id: 'd-2', status: 'dead', lastError: 'timeout' })],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    })
    render(<DeliveryLogList orgId="org-1" sinkId="sink-1" canManage={true} />)
    expect(screen.getAllByText('task.created')).toHaveLength(2)
    expect(screen.getByText('timeout')).toBeInTheDocument()
  })

  it('dead/failedの行にのみ再送ボタンを表示し、クリックで個別再送する', async () => {
    useRedeliverDeliveryMutateAsyncMock.mockResolvedValue({ ok: true })
    useSinkDeliveriesMock.mockReturnValue({
      deliveries: [delivery({ id: 'd-sent', status: 'sent' }), delivery({ id: 'd-dead', status: 'dead' })],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    })
    render(<DeliveryLogList orgId="org-1" sinkId="sink-1" canManage={true} />)

    const redeliverButtons = screen.getAllByRole('button', { name: '再送' })
    expect(redeliverButtons).toHaveLength(1)

    await act(async () => {
      fireEvent.click(redeliverButtons[0])
    })

    expect(useRedeliverDeliveryMutateAsyncMock).toHaveBeenCalledWith('d-dead')
    expect(refetchMock).toHaveBeenCalled()
  })

  it('一括再送ボタンでsink単位の再送を呼び、件数をtoastで表示する', async () => {
    useRedeliverSinkMutateAsyncMock.mockResolvedValue({ ok: true, count: 4 })
    render(<DeliveryLogList orgId="org-1" sinkId="sink-1" canManage={true} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /まとめて再送/ }))
    })

    expect(useRedeliverSinkMutateAsyncMock).toHaveBeenCalledWith({ orgId: 'org-1', sinkId: 'sink-1' })
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining('4'))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('member(canManage=false)には再送ボタンを表示しない', () => {
    useSinkDeliveriesMock.mockReturnValue({
      deliveries: [delivery({ status: 'dead' })],
      isLoading: false,
      error: null,
      refetch: refetchMock,
    })
    render(<DeliveryLogList orgId="org-1" sinkId="sink-1" canManage={false} />)
    expect(screen.queryByRole('button', { name: '再送' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /まとめて再送/ })).not.toBeInTheDocument()
  })

  it('もっと見るボタンでlimitを増やしてuseSinkDeliveriesを呼び直す', () => {
    // 30件ちょうど返ってきた場合は「まだあるかもしれない」のでもっと見る を表示する
    const many = Array.from({ length: 30 }, (_, i) => delivery({ id: `d-${i}` }))
    useSinkDeliveriesMock.mockReturnValue({ deliveries: many, isLoading: false, error: null, refetch: refetchMock })
    render(<DeliveryLogList orgId="org-1" sinkId="sink-1" canManage={true} />)

    expect(useSinkDeliveriesMock).toHaveBeenLastCalledWith('org-1', 'sink-1', 30)

    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    expect(useSinkDeliveriesMock).toHaveBeenLastCalledWith('org-1', 'sink-1', 60)
  })
})

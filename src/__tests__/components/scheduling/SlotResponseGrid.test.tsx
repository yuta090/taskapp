import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SlotResponseGrid } from '@/components/scheduling/SlotResponseGrid'
import type { ProposalSlot } from '@/types/database'

// 日程調整の回答表は、Realtime の public チャネルに入らない。
//
// - 本番は 2026-09-15 に「Allow public access to channels」をオフにした（private チャネルだけ許可）。
//   public チャネルに入ろうとすると断られ、realtime-js は開いている間ずっと10秒ごとに入り直す。
// - もともと本番の publication は表が0件で、回答の変化は1件も届いていなかった。
//   それなのに緑の「Live」を出していたので、表示もやめる。

type StatusCb = (status: string) => void

const mockChannel = vi.fn((topic: string) => {
  const channel = {
    topic,
    on: vi.fn(() => channel),
    // 入った扱いをすぐ返す（以前の実装なら「Live」が出る状態を作る）
    subscribe: vi.fn((cb?: StatusCb) => {
      cb?.('SUBSCRIBED')
      return channel
    }),
  }
  return channel
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (topic: string) => mockChannel(topic),
    removeChannel: vi.fn(),
  }),
}))

const SLOT = {
  id: 'slot-1',
  slot_order: 0,
  start_at: '2026-09-20T10:00:00+09:00',
  end_at: '2026-09-20T11:00:00+09:00',
} as ProposalSlot

function renderGrid() {
  const props = {
    slots: [SLOT],
    respondents: [],
    responsesBySlot: {},
    myRespondentId: null,
    onSubmit: vi.fn(async () => {}),
    proposalId: 'proposal-1',
    getSlotSummary: () => ({ available: 0, proceed: 0, unavailable: 0, pending: 1 }),
  }
  const utils = render(<SlotResponseGrid {...props} />)
  // 以前の実装は「入った」を ref に持つだけだったので、描き直して表示を確かめる
  utils.rerender(<SlotResponseGrid {...props} />)
  return utils
}

describe('SlotResponseGrid', () => {
  beforeEach(() => {
    mockChannel.mockClear()
  })

  it('Realtime のチャネルに入らない', () => {
    renderGrid()
    expect(mockChannel).not.toHaveBeenCalled()
  })

  it('「Live」表示を出さない', () => {
    renderGrid()
    expect(screen.queryByText('Live')).toBeNull()
  })

  it('回答表と凡例は今までどおり出す', () => {
    renderGrid()
    expect(screen.getByTestId('slot-response-grid')).toBeTruthy()
    expect(screen.getByText('未回答')).toBeTruthy()
    expect(screen.getByText('回答者')).toBeTruthy()
  })
})

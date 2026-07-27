import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SharedLineUsagePanel } from '@/components/secretary/SharedLineUsagePanel'
import type { SharedLineUsageResult } from '@/lib/hooks/useSharedLineUsage'

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

const mockUsage = vi.fn<() => SharedLineUsageResult>()
vi.mock('@/lib/hooks/useSharedLineUsage', () => ({
  useSharedLineUsage: () => mockUsage(),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mockUsage.mockReset()
})

describe('SharedLineUsagePanel', () => {
  it('未接続(view=null)は何も描画しない', () => {
    mockUsage.mockReturnValue({ view: null, loading: false, error: false })
    const { container } = render(<SharedLineUsagePanel orgId={ORG} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ロード中は何も描画しない', () => {
    mockUsage.mockReturnValue({ view: null, loading: true, error: false })
    const { container } = render(<SharedLineUsagePanel orgId={ORG} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('通常(ok)は 使用数/上限 と残数を出し、Pro導線は出さない', () => {
    mockUsage.mockReturnValue({
      view: { unlimited: false, used: 12, quota: 50, remaining: 38, ratio: 0.24, level: 'ok' },
      loading: false,
      error: false,
    })
    render(<SharedLineUsagePanel orgId={ORG} />)
    expect(screen.getByText('12 / 50 通')).toBeInTheDocument()
    expect(screen.getByText(/あと 38 通/)).toBeInTheDocument()
    expect(screen.queryByText(/自社LINE（Pro）/)).not.toBeInTheDocument()
  })

  it('soft は警告文と Pro導線を出す', () => {
    mockUsage.mockReturnValue({
      view: { unlimited: false, used: 42, quota: 50, remaining: 8, ratio: 0.84, level: 'soft' },
      loading: false,
      error: false,
    })
    render(<SharedLineUsagePanel orgId={ORG} />)
    expect(screen.getByText(/上限が近づいています/)).toBeInTheDocument()
    expect(screen.getByText(/自社LINE（Pro）/)).toBeInTheDocument()
  })

  it('hard は上限到達文と Pro導線を出す', () => {
    mockUsage.mockReturnValue({
      view: { unlimited: false, used: 50, quota: 50, remaining: 0, ratio: 1, level: 'hard' },
      loading: false,
      error: false,
    })
    render(<SharedLineUsagePanel orgId={ORG} />)
    expect(screen.getByText(/送信上限に達しました/)).toBeInTheDocument()
    expect(screen.getByText(/自社LINE（Pro）/)).toBeInTheDocument()
  })

  it('無制限(Pro)は「無制限」と出し、上限バーは出さない', () => {
    mockUsage.mockReturnValue({
      view: { unlimited: true, used: 999, quota: null, remaining: null, ratio: null, level: 'ok' },
      loading: false,
      error: false,
    })
    render(<SharedLineUsagePanel orgId={ORG} />)
    expect(screen.getByText('無制限')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewInspector } from '@/components/review/ReviewInspector'
import type { Review } from '@/types/database'

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    task_id: 't1',
    status: 'open',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Review
}

describe('ReviewInspector — 社内承認の用語統一 (M-1)', () => {
  it('未対応のレビューは「社内承認待ち」と表示する', () => {
    render(<ReviewInspector review={makeReview({ status: 'open' })} onClose={vi.fn()} />)
    expect(screen.getByText('社内承認待ち')).toBeInTheDocument()
  })

  it('承認済みのレビューは「社内承認済み」と表示する', () => {
    render(<ReviewInspector review={makeReview({ status: 'approved' })} onClose={vi.fn()} />)
    expect(screen.getByText('社内承認済み')).toBeInTheDocument()
  })
})

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewList } from '@/components/review/ReviewList'
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

describe('ReviewList — 社内承認の用語統一 (M-1)', () => {
  it('未対応のレビューは「社内承認待ち」と表示する', () => {
    render(<ReviewList reviews={[makeReview({ status: 'open' })]} />)
    expect(screen.getByText('社内承認待ち')).toBeInTheDocument()
  })

  it('承認済みのレビューは「社内承認済み」と表示する', () => {
    render(<ReviewList reviews={[makeReview({ status: 'approved' })]} />)
    expect(screen.getByText('社内承認済み')).toBeInTheDocument()
  })

  it('空状態のメッセージが「社内承認待ちの項目はありません」になる', () => {
    render(<ReviewList reviews={[]} />)
    expect(screen.getByText('社内承認待ちの項目はありません')).toBeInTheDocument()
  })
})

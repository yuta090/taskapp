import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextDeliveryMetric } from '@/components/portal/dashboard/NextDeliveryMetric'

/**
 * Regression tests for H-5: the "次回納品予定" card rendered the date and the
 * overdue day count inline in one text-2xl line (e.g. "2025/10/15 (263日超過)"),
 * which overflowed/wrapped mid-parenthesis on large day counts. The date and
 * the overdue label must always be on separate lines so no day count can
 * break the layout.
 */
describe('NextDeliveryMetric (H-5)', () => {
  it('renders the date and a large overdue day count on separate lines', () => {
    render(<NextDeliveryMetric milestoneName="納品フェーズ1" dueDate="2025-10-15" overdueDays={263} />)

    const dateEl = screen.getByText('2025/10/15')
    const overdueEl = screen.getByText('263日超過')

    expect(dateEl).toBeInTheDocument()
    expect(overdueEl).toBeInTheDocument()
    // Date and overdue count are sibling lines (not concatenated into one text node/line)
    expect(overdueEl).not.toBe(dateEl)
    expect(dateEl.textContent).not.toContain('263日超過')
    expect(dateEl.parentElement).toHaveClass('flex-col')
  })

  it('does not show an overdue label when not overdue', () => {
    render(<NextDeliveryMetric milestoneName="納品フェーズ1" dueDate="2099-01-01" overdueDays={0} />)

    expect(screen.getByText('2099/1/1')).toBeInTheDocument()
    expect(screen.queryByText(/日超過/)).not.toBeInTheDocument()
  })

  it('shows "未定" when there is no due date', () => {
    render(<NextDeliveryMetric dueDate={null} overdueDays={0} />)

    expect(screen.getByText('未定')).toBeInTheDocument()
  })

  it('handles an extreme overdue count without a layout-breaking single line', () => {
    render(<NextDeliveryMetric milestoneName="納品フェーズ1" dueDate="2020-01-01" overdueDays={9999} />)

    expect(screen.getByText('9999日超過')).toBeInTheDocument()
  })
})

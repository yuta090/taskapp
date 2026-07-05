import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RiskSummaryBanner } from '@/components/risk/RiskSummaryBanner'

// #89: リスク/期限超過を一覧の先頭に昇格。PM がガントを開かなくても気づけるようにする。

describe('RiskSummaryBanner (#89)', () => {
  it('期限超過も高リスクも 0 のときは何も表示しない', () => {
    const { container } = render(
      <RiskSummaryBanner overdueCount={0} highRiskCount={0} href="/x/gantt" />
    )
    expect(container.firstChild).toBeNull()
  })

  it('期限超過があるとき件数とリンクを表示する', () => {
    render(<RiskSummaryBanner overdueCount={3} highRiskCount={0} href="/x/gantt" />)
    const banner = screen.getByTestId('risk-summary-banner')
    expect(banner.textContent).toContain('3')
    expect(banner.textContent).toContain('期限超過')
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/x/gantt')
  })

  it('高リスクのみのときも表示する', () => {
    render(<RiskSummaryBanner overdueCount={0} highRiskCount={2} href="/x/gantt" />)
    const banner = screen.getByTestId('risk-summary-banner')
    expect(banner.textContent).toContain('2')
    expect(banner.textContent).toContain('高リスク')
  })

  it('両方あるとき両方の件数を表示する', () => {
    render(<RiskSummaryBanner overdueCount={5} highRiskCount={1} href="/x/gantt" />)
    const banner = screen.getByTestId('risk-summary-banner')
    expect(banner.textContent).toContain('5')
    expect(banner.textContent).toContain('1')
    expect(banner.textContent).toContain('期限超過')
    expect(banner.textContent).toContain('高リスク')
  })
})

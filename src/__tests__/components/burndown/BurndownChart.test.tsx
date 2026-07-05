import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BurndownChart } from '@/components/burndown/BurndownChart'
import type { BurndownData } from '@/lib/burndown/computeBurndown'

function makeData(overrides: Partial<BurndownData> = {}): BurndownData {
  return {
    milestoneId: 'ms-1',
    milestoneName: 'テストマイルストーン',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    totalTasks: 0,
    dataAvailableFrom: null,
    dailySnapshots: [],
    ...overrides,
  }
}

describe('BurndownChart — 空状態の教育化 (初回UX改善 D)', () => {
  it('タスクが0件のとき、期限/マイルストーン設定を促す案内文を表示する', () => {
    render(<BurndownChart data={makeData({ totalTasks: 0 })} />)
    expect(
      screen.getByText('期限付きのタスクやマイルストーンを設定すると、バーンダウンチャートがここに表示されます')
    ).toBeInTheDocument()
  })
})

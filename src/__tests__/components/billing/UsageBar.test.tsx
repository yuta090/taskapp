import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageBar } from '@/components/billing/UsageBar'

describe('UsageBar', () => {
  it('should render label and usage', () => {
    render(<UsageBar label="プロジェクト" used={3} limit={5} />)

    expect(screen.getByText('プロジェクト')).toBeInTheDocument()
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
  })

  it('should show unlimited when limit is null', () => {
    render(<UsageBar label="プロジェクト" used={10} limit={null} />)

    expect(screen.getByText('10 / 無制限')).toBeInTheDocument()
  })

  it('should show unit when provided', () => {
    render(<UsageBar label="メンバー" used={5} limit={10} unit="人" />)

    expect(screen.getByText('5人 / 10人')).toBeInTheDocument()
  })

  it('should apply warning color when near limit (80%+)', () => {
    const { container } = render(<UsageBar label="テスト" used={4} limit={5} />)

    // 80%以上なのでamber-500が適用されるべき
    const progressBar = container.querySelector('[class*="bg-amber"]')
    expect(progressBar).toBeInTheDocument()
  })

  it('should apply danger color when at limit (100%)', () => {
    const { container } = render(<UsageBar label="テスト" used={5} limit={5} />)

    // 100%なのでred-500が適用されるべき
    const progressBar = container.querySelector('[class*="bg-red"]')
    expect(progressBar).toBeInTheDocument()
  })

  it('should apply normal color when under 80%', () => {
    const { container } = render(<UsageBar label="テスト" used={2} limit={5} />)

    // 40%なのでindigo-500が適用されるべき
    const progressBar = container.querySelector('[class*="bg-indigo"]')
    expect(progressBar).toBeInTheDocument()
  })

  it('should handle zero limit as at-limit', () => {
    const { container } = render(<UsageBar label="テスト" used={0} limit={0} />)

    // limit=0は100%として扱う
    const progressBar = container.querySelector('[class*="bg-red"]')
    expect(progressBar).toBeInTheDocument()
  })

  it('should not show warning colors when showWarning is false', () => {
    const { container } = render(
      <UsageBar label="テスト" used={5} limit={5} showWarning={false} />
    )

    // showWarning=falseなのでred/amberは適用されない
    const progressBar = container.querySelector('[class*="bg-indigo"]')
    expect(progressBar).toBeInTheDocument()
  })
})

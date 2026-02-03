import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LimitWarning } from '@/components/billing/LimitWarning'

describe('LimitWarning', () => {
  it('should not render when remaining is null (unlimited)', () => {
    const { container } = render(
      <LimitWarning type="projects" remaining={null} isAtLimit={false} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('should not render when remaining > 2 and not at limit', () => {
    const { container } = render(
      <LimitWarning type="projects" remaining={5} isAtLimit={false} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('should show warning when remaining <= 2', () => {
    render(
      <LimitWarning type="members" remaining={2} isAtLimit={false} />
    )

    expect(screen.getByText('メンバーの残り枠: あと2')).toBeInTheDocument()
    expect(screen.getByText('上限に近づいています')).toBeInTheDocument()
  })

  it('should show error when at limit', () => {
    render(
      <LimitWarning type="clients" remaining={0} isAtLimit={true} />
    )

    expect(screen.getByText('クライアントの上限に達しました')).toBeInTheDocument()
    expect(screen.getByText('これ以上追加するにはプランのアップグレードが必要です')).toBeInTheDocument()
  })

  it('should show upgrade link when at limit', () => {
    render(
      <LimitWarning type="projects" remaining={0} isAtLimit={true} />
    )

    const link = screen.getByText('アップグレード')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/settings/billing')
  })

  it('should use custom upgrade URL', () => {
    render(
      <LimitWarning
        type="projects"
        remaining={0}
        isAtLimit={true}
        upgradeUrl="/custom/upgrade"
      />
    )

    const link = screen.getByText('アップグレード')
    expect(link.closest('a')).toHaveAttribute('href', '/custom/upgrade')
  })

  it('should show correct label for each type', () => {
    const types = ['projects', 'members', 'clients', 'storage'] as const
    const labels = ['プロジェクト', 'メンバー', 'クライアント', 'ストレージ']

    types.forEach((type, index) => {
      const { unmount } = render(
        <LimitWarning type={type} remaining={0} isAtLimit={true} />
      )

      expect(screen.getByText(`${labels[index]}の上限に達しました`)).toBeInTheDocument()
      unmount()
    })
  })
})

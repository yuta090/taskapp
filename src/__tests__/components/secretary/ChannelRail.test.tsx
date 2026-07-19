import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChannelRail } from '@/components/secretary/ChannelRail'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

/**
 * 「つなぐ」ハブの左レール（チャネル軸）。受信チャネルを縦に並べる。
 * 現状つなげるのは LINE のみ。Slack/Teams は「近日」の非クリック行として枠だけ見せ、
 * routeの無いチャネルへ遷移させない。チャネル追加＝この配列に1行足すだけの骨格。
 */
describe('ChannelRail', () => {
  it('LINEはリンクで /secretary/connect/line を指す', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    const line = screen.getByTestId('channel-rail-line')
    expect(line.tagName).toBe('A')
    expect(line).toHaveAttribute('href', `/${ORG}/secretary/connect/line`)
  })

  it('activeChannel=line のとき aria-current=page が付く', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    expect(screen.getByTestId('channel-rail-line')).toHaveAttribute('aria-current', 'page')
  })

  it('Slack/Teams はリンクでなく（遷移不可・aria-disabled）「近日」表示', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    const slack = screen.getByTestId('channel-rail-slack')
    const teams = screen.getByTestId('channel-rail-teams')
    expect(slack.tagName).not.toBe('A')
    expect(teams.tagName).not.toBe('A')
    expect(slack).toHaveAttribute('aria-disabled', 'true')
    expect(teams).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getAllByText('近日')).toHaveLength(2)
  })
})

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/org/secretary/connect/line',
}))

const ORG = '11111111-1111-4111-8111-111111111111'

/**
 * 「つなぐ」ハブの左レール（チャネル軸）。レジストリ駆動。
 * GA/BETAはリンク、PLANNED(messenger)は遷移不可の「近日」行。チャネル追加＝registryに
 * 1エントリ足すだけでレールに並ぶ。
 */
describe('ChannelRail (registry-driven)', () => {
  it('LINEはリンクで /secretary/connect/line を指す', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    const line = screen.getByTestId('channel-rail-line')
    expect(line.tagName).toBe('A')
    expect(line).toHaveAttribute('href', `/${ORG}/secretary/connect/line`)
  })

  it('主要チャット(slack/chatwork/telegram/discord/teams/whatsapp)がリンクとして並ぶ', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    for (const id of ['slack', 'chatwork', 'telegram', 'discord', 'teams', 'whatsapp']) {
      const el = screen.getByTestId(`channel-rail-${id}`)
      expect(el.tagName).toBe('A')
      expect(el).toHaveAttribute('href', `/${ORG}/secretary/connect/${id}`)
    }
  })

  it('activeChannel=line のとき aria-current=page が付く', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    expect(screen.getByTestId('channel-rail-line')).toHaveAttribute('aria-current', 'page')
  })

  it('PLANNED(messenger)は遷移不可・aria-disabled・「近日」表示', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    const messenger = screen.getByTestId('channel-rail-messenger')
    expect(messenger.tagName).not.toBe('A')
    expect(messenger).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('近日')).toBeInTheDocument()
  })

  it('emailはチャット系でないためレールに出さない', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    expect(screen.queryByTestId('channel-rail-email')).toBeNull()
  })

  it('activeChannel未指定なら pathname からアクティブを導出する', () => {
    render(<ChannelRail orgId={ORG} />)
    expect(screen.getByTestId('channel-rail-line')).toHaveAttribute('aria-current', 'page')
  })
})

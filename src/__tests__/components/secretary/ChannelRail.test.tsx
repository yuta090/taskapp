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
 * GA/BETAはリンク、PLANNEDは遷移不可の「近日」行。チャネル追加＝registryに
 * 1エントリ足すだけでレールに並ぶ。
 * 現状チャット系は全て ga/beta（messenger も beta 昇格済み）で、PLANNED は email のみ＝
 * チャット系レールには「近日」行が出ない。
 */
describe('ChannelRail (registry-driven)', () => {
  it('LINEはリンクで /secretary/connect/line を指す', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    const line = screen.getByTestId('channel-rail-line')
    expect(line.tagName).toBe('A')
    expect(line).toHaveAttribute('href', `/${ORG}/secretary/connect/line`)
  })

  it('主要チャット(slack/chatwork/telegram/discord/teams/whatsapp/messenger)がリンクとして並ぶ', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    for (const id of ['slack', 'chatwork', 'telegram', 'discord', 'teams', 'whatsapp', 'messenger']) {
      const el = screen.getByTestId(`channel-rail-${id}`)
      expect(el.tagName).toBe('A')
      expect(el).toHaveAttribute('href', `/${ORG}/secretary/connect/${id}`)
    }
  })

  it('activeChannel=line のとき aria-current=page が付く', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    expect(screen.getByTestId('channel-rail-line')).toHaveAttribute('aria-current', 'page')
  })

  it('現状チャット系にPLANNEDは無く「近日」行が出ない（messengerもbeta昇格済み）', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    // messenger は beta 昇格でリンク化。email(planned)はチャット系でないためレール対象外。
    expect(screen.queryByText('近日')).toBeNull()
  })

  it('betaチャネルに「BETA」バッジを出さない（statusは内部区分でありユーザーには見せない）', () => {
    render(<ChannelRail orgId={ORG} activeChannel="line" />)
    expect(screen.queryByText('BETA')).toBeNull()
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

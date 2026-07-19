import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

/**
 * チャネル連携ハブ統合(D3+骨格移設)後、トップタブは4本に集約:
 * メッセージ / 確認待ち / 外部連携 / つなぐ(connect)。
 * 旧「つなぐ(user-links)」「相手先グループ(group-links)」の別タブは廃止し、
 * LINE配下(/secretary/connect/line, /connect/line/groups)へ畳んだ。
 */
describe('SecretaryTabNav', () => {
  it('トップタブは4本（messages/approvals/integrations/connect）', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="messages" />)
    expect(screen.getByTestId('secretary-tab-messages')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-approvals')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-integrations')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-connect')).toBeInTheDocument()
  })

  it('connectタブは /secretary/connect/line を指す', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="messages" />)
    expect(screen.getByTestId('secretary-tab-connect')).toHaveAttribute(
      'href',
      `/${ORG}/secretary/connect/line`,
    )
  })

  it('activeTab=connect のときそのタブがアクティブ表示になる', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="connect" />)
    expect(screen.getByTestId('secretary-tab-connect').className).toContain('bg-gray-50')
  })

  it('旧 user-links / group-links の別タブは存在しない', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="messages" />)
    expect(screen.queryByTestId('secretary-tab-user-links')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secretary-tab-group-links')).not.toBeInTheDocument()
  })
})

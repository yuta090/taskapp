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

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

/**
 * チャネル連携ハブ統合(D3+骨格移設)後、トップタブは4本に集約:
 * メッセージ / 確認待ち / 外部連携 / つなぐ(connect)。
 * 旧「つなぐ(user-links)」「相手先グループ(group-links)」の別タブは廃止し、
 * LINE配下(/secretary/connect/line, /connect/line/groups)へ畳んだ。
 *
 * shell-layout統合後: activeTab は props ではなく usePathname() の自己判定に変わった
 * (secretary/layout.tsx に一元化し、タブ切替のたびにタブバーごとremountされる問題を解消するため)。
 */
describe('SecretaryTabNav', () => {
  it('トップタブは4本（messages/approvals/integrations/connect）', () => {
    usePathnameMock.mockReturnValue(`/${ORG}/secretary`)
    render(<SecretaryTabNav orgId={ORG} />)
    expect(screen.getByTestId('secretary-tab-messages')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-approvals')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-integrations')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-connect')).toBeInTheDocument()
  })

  it('connectタブは /secretary/connect/line を指す', () => {
    usePathnameMock.mockReturnValue(`/${ORG}/secretary`)
    render(<SecretaryTabNav orgId={ORG} />)
    expect(screen.getByTestId('secretary-tab-connect')).toHaveAttribute(
      'href',
      `/${ORG}/secretary/connect/line`,
    )
  })

  it('旧 user-links / group-links の別タブは存在しない', () => {
    usePathnameMock.mockReturnValue(`/${ORG}/secretary`)
    render(<SecretaryTabNav orgId={ORG} />)
    expect(screen.queryByTestId('secretary-tab-user-links')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secretary-tab-group-links')).not.toBeInTheDocument()
  })

  it.each([
    [`/${ORG}/secretary`, 'messages'],
    [`/${ORG}/secretary/approvals`, 'approvals'],
    [`/${ORG}/secretary/integrations`, 'integrations'],
    [`/${ORG}/secretary/connect`, 'connect'],
    [`/${ORG}/secretary/connect/line`, 'connect'],
    // 深い階層(チャネル配下のさらに下の階層)でもプレフィックス判定でconnectのまま
    [`/${ORG}/secretary/connect/line/groups`, 'connect'],
    // 旧ルートが残っていてもconnect扱い
    [`/${ORG}/secretary/user-links`, 'connect'],
    [`/${ORG}/secretary/group-links`, 'connect'],
  ])('pathname=%s のとき %s タブがアクティブ表示になる', (pathname, activeKey) => {
    usePathnameMock.mockReturnValue(pathname)
    render(<SecretaryTabNav orgId={ORG} />)
    // アクティブ表示クラス'bg-gray-50'は非アクティブ側の'hover:bg-gray-50'と部分一致するため、
    // クラストークン単位(split)で厳密に判定する。
    const classTokens = (testId: string) =>
      screen.getByTestId(testId).className.split(/\s+/).filter(Boolean)

    expect(classTokens(`secretary-tab-${activeKey}`)).toContain('bg-gray-50')

    for (const key of ['messages', 'approvals', 'integrations', 'connect']) {
      if (key === activeKey) continue
      expect(classTokens(`secretary-tab-${key}`)).not.toContain('bg-gray-50')
    }
  })
})

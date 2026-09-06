import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'

/**
 * GroupLinkPanel — 連携ハブの「2. 相手先とのグループLINEをつなぐ」カードの中身。
 * 手順・QR・コード発行・承認はすべて専用の group-links ページに集約してあるため、
 * ハブでは「次の画面で案内する」一言＋ボタンだけを出す（QRを重ねて出さない）。
 */

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

describe('GroupLinkPanel', () => {
  it('group-links ページへのボタンだけを出し、QRや手順は出さない', () => {
    render(<GroupLinkPanel orgId={ORG} />)

    const cta = screen.getByRole('link', { name: /グループをつなぐ/ })
    expect(cta).toHaveAttribute('href', `/${ORG}/secretary/connect/line/groups`)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(/友だち追加/)).not.toBeInTheDocument()
  })
})

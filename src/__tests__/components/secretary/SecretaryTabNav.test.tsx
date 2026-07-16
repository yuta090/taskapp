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
 * グループ紐付け承認タブ（Stage 4・PR3a）は promote の digest 承認("確認待ち"タブ)とは別タブ。
 * 命名衝突を避けるため key/label ともに"グループ紐付け"系で分離する。
 */
describe('SecretaryTabNav', () => {
  it('group-links タブが表示される', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="messages" />)
    expect(screen.getByTestId('secretary-tab-group-links')).toBeInTheDocument()
  })

  it('activeTab=group-links のときそのタブがアクティブ表示になる', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="group-links" />)
    const tab = screen.getByTestId('secretary-tab-group-links')
    expect(tab.className).toContain('bg-gray-50')
  })

  it('既存の確認待ちタブ(approvals)と共存する（衝突しない別タブ）', () => {
    render(<SecretaryTabNav orgId={ORG} activeTab="messages" />)
    expect(screen.getByTestId('secretary-tab-approvals')).toBeInTheDocument()
    expect(screen.getByTestId('secretary-tab-group-links')).toBeInTheDocument()
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * secretary/layout.tsx — 秘書4タブ(メッセージ/確認待ち/ツール連携/つなぐ)共通の静的シェル。
 * タブバー(SecretaryTabNav)をここで一元描画し、配下のpage切替でタブバーごと
 * remountされないようにする(骨格の永続化)。
 */

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

const { default: SecretaryLayout } = await import('@/app/(internal)/[orgId]/secretary/layout')

beforeEach(() => {
  vi.clearAllMocks()
  usePathnameMock.mockReturnValue(`/${ORG}/secretary`)
})

describe('SecretaryLayout', () => {
  it('タブバー(SecretaryTabNav)を先頭に描画し、その下にchildrenを描画する', async () => {
    const jsx = await SecretaryLayout({
      children: <div data-testid="page-content">content</div>,
      params: Promise.resolve({ orgId: ORG }),
    })
    render(jsx)
    expect(screen.getByTestId('secretary-tab-messages')).toBeInTheDocument()
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
  })

  it('タブバーは1つだけ描画される(二重nav禁止)', async () => {
    const jsx = await SecretaryLayout({
      children: <div data-testid="page-content">content</div>,
      params: Promise.resolve({ orgId: ORG }),
    })
    render(jsx)
    expect(screen.getAllByTestId('secretary-tab-messages')).toHaveLength(1)
  })

  it('await params 以外のawaitを持たない(静的シェル): orgIdを正しくSecretaryTabNavへ渡す', async () => {
    const jsx = await SecretaryLayout({
      children: <div />,
      params: Promise.resolve({ orgId: ORG }),
    })
    render(jsx)
    expect(screen.getByTestId('secretary-tab-connect')).toHaveAttribute(
      'href',
      `/${ORG}/secretary/connect/line`,
    )
  })
})

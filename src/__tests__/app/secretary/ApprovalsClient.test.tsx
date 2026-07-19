import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApprovalsClient } from '@/app/(internal)/[orgId]/secretary/approvals/ApprovalsClient'

/**
 * ApprovalsClient — shell-layout統合後は自前でSecretaryTabNavを描画しない
 * (タブバーは親の secretary/layout.tsx が一元描画する。二重nav禁止)。
 */

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('@/lib/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ has: () => false, features: [], planName: null, loading: false, error: null }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/api/channels/digest-tasks/pending')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
      }
      if (url.includes('/api/channels/groups')) {
        return Promise.resolve({ ok: true, json: async () => ({ groups: [] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
  )
})

describe('ApprovalsClient', () => {
  it('SecretaryTabNavを自前で描画しない(タブバーは親の secretary/layout.tsx が持つ)', async () => {
    render(<ApprovalsClient orgId="org-1" />)
    expect(await screen.findByText('確認待ちの候補はありません。')).toBeInTheDocument()
    expect(screen.queryByTestId('secretary-tab-approvals')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secretary-tab-messages')).not.toBeInTheDocument()
  })
})

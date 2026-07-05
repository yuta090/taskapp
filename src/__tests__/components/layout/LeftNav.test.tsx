import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeftNav } from '@/components/layout/LeftNav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/org1/project/space1',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: () => ({ count: 0, pendingCount: 0, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [
      {
        id: 'space1',
        name: 'テストプロジェクト',
        orgId: 'org1',
        orgName: 'テスト組織',
        role: 'admin',
        archivedAt: null,
        groupId: null,
        sortOrder: 0,
      },
    ],
  }),
}))

vi.mock('@/lib/hooks/useSpaceGroups', () => ({
  useSpaceGroups: () => ({
    groups: [],
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    reorderGroups: vi.fn(),
    moveSpaceToGroup: vi.fn(),
  }),
}))

describe('LeftNav — 用語統一 (M-1)', () => {
  it('サイドバーのリンクが「クライアント確認待ち」を使う', () => {
    render(<LeftNav />)
    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.queryByText('確認待ち')).not.toBeInTheDocument()
  })
})

vi.mock('@/components/onboarding/InternalOnboardingWalkthrough', () => ({
  resetInternalOnboarding: vi.fn(() => Promise.resolve()),
}))

describe('LeftNav — 常設ヘルプ導線 (初回UX改善 D)', () => {
  it('ヘルプボタンを押すとポップオーバーに3項目が表示される', () => {
    render(<LeftNav />)
    fireEvent.click(screen.getByTestId('leftnav-help-button'))

    expect(screen.getByText('操作ガイドを再表示')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '用語ガイド' })).toHaveAttribute('href', '/help#glossary')
    expect(screen.getByRole('link', { name: '使い方マニュアル' })).toHaveAttribute('href', '/help')
  })

  it('「操作ガイドを再表示」の導線はヘルプメニューにのみ存在する（重複導線なし）', () => {
    render(<LeftNav />)
    fireEvent.click(screen.getByTestId('leftnav-help-button'))

    expect(screen.getAllByText('操作ガイドを再表示')).toHaveLength(1)
  })
})

describe('LeftNav — 名称の明確化 (初回UX改善)', () => {
  it('プロジェクト配下のサブナビは「すべてのタスク」と表記する（「タスク」単体は使わない）', () => {
    render(<LeftNav />)
    expect(screen.getByText('すべてのタスク')).toBeInTheDocument()
    expect(screen.queryByText('タスク', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('受信トレイ/マイタスクの上に「個人」セクション見出しを表示する', () => {
    render(<LeftNav />)
    expect(screen.getByText('個人')).toBeInTheDocument()
  })

  it('受信トレイ/マイタスクにはtooltip(title属性)が展開時も付与される', () => {
    render(<LeftNav />)
    expect(screen.getByText('受信トレイ').closest('a')).toHaveAttribute(
      'title',
      '承認・修正依頼・ボールの受け渡しなど、対応が必要な通知'
    )
    expect(screen.getByText('マイタスク').closest('a')).toHaveAttribute(
      'title',
      '自分が担当者になっているタスク'
    )
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'

// Wiki が空のときの「テンプレートから作成」CTA は、内部で PresetApplicator
// （rpc_apply_preset_to_space）を使う。このRPCは app_can_write_space の前に
// 「space_memberships の行がはっきり admin/editor」かを確かめるため（20260911143112_
// space_role_boundary.sql）、canEdit（行が無い社内メンバーも含む）ではなく canEditMoney
// （代理店設定・ポータル表示設定と同じ、より狭い規則）で出し分ける。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [],
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    deletePage: vi.fn(),
    fetchPage: vi.fn(),
    fetchVersions: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [] }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user1' } }),
}))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

let mockCanEditMoney = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: mockCanEditMoney, resolved: true, loading: false }),
}))

function setup() {
  return render(<WikiPageClient orgId="org1" spaceId="space1" />)
}

beforeEach(() => {
  mockCanEditMoney = true
})

describe('WikiPageClient — 空のWikiのテンプレート適用CTA', () => {
  it('space の行が admin/editor（canEditMoney）なら「テンプレートから作成」が出る', () => {
    setup()
    expect(screen.getByRole('button', { name: /テンプレートから作成/ })).toBeInTheDocument()
  })

  it('編集はできても行が無い社内メンバー等（canEdit:true・canEditMoney:false）では出さない', () => {
    mockCanEditMoney = false
    setup()
    expect(screen.queryByRole('button', { name: /テンプレートから作成/ })).not.toBeInTheDocument()
  })
})

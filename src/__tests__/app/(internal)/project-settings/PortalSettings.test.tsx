import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortalSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/PortalSettings'

// ポータル表示設定(spaces.portal_visible_sections)の更新は、代理店設定と同じ形の
// DBトリガー(guard_portal_visible_sections, 20260307_001_portal_sections_write_guard.sql)で、
// space_memberships の行がはっきり admin/editor の人だけに絞られている（行が無い社内
// メンバーへの editor 扱いフォールバックは無い）。canEditMoney(canEditSpaceMoney)と
// 全く同じ規則なので、そのまま使う。

const DEFAULT_SECTIONS = {
  tasks: true,
  requests: true,
  all_tasks: true,
  files: true,
  meetings: true,
  wiki: true,
  history: true,
}

const updateSectionsMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/usePortalVisibility', () => ({
  usePortalVisibility: () => ({
    sections: DEFAULT_SECTIONS,
    loading: false,
    updateSections: updateSectionsMock,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let mockCanEditMoney = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: mockCanEditMoney, resolved: true, loading: false }),
}))

beforeEach(() => {
  updateSectionsMock.mockClear()
  mockCanEditMoney = true
})

describe('PortalSettings — space の行が admin/editor には従来どおり操作できる', () => {
  it('トグルを押すと更新される', () => {
    render(<PortalSettings orgId="o1" spaceId="s1" />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(updateSectionsMock).toHaveBeenCalled()
  })
})

describe('PortalSettings — 操作できない人（閲覧者・行が無い社内メンバー等）には出さない', () => {
  it('すべてのトグルが disabled になる', () => {
    mockCanEditMoney = false
    render(<PortalSettings orgId="o1" spaceId="s1" />)

    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toBeDisabled()
    }
  })

  it('押しても更新されない', () => {
    mockCanEditMoney = false
    render(<PortalSettings orgId="o1" spaceId="s1" />)

    fireEvent.click(screen.getAllByRole('switch')[0])

    expect(updateSectionsMock).not.toHaveBeenCalled()
  })
})

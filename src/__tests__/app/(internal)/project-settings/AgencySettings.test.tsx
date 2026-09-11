import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgencySettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/AgencySettings'

// 代理店モードの設定(spaces.agency_mode 等)は DB のガード
// （guard_agency_settings, 20260308_002_agency_settings_write_guard.sql）と同じく、
// space_memberships の行がはっきり admin/editor の人だけができる
// （行が無い社内メンバーも含め、それ以外は操作できない）。判定は canEditMoney を使う。

const mockUpdate = vi.fn().mockResolvedValue(undefined)
let mockData = {
  agency_mode: true,
  default_margin_rate: 35,
  vendor_settings: { show_client_name: false, allow_client_comments: false },
}

vi.mock('@/lib/hooks/useAgencyMode', () => ({
  useAgencyMode: () => ({ data: mockData, loading: false, update: mockUpdate }),
}))

let canEditMoney = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney, loading: false }),
}))

beforeEach(() => {
  mockUpdate.mockClear()
  canEditMoney = true
  mockData = {
    agency_mode: true,
    default_margin_rate: 35,
    vendor_settings: { show_client_name: false, allow_client_comments: false },
  }
})

describe('AgencySettings — space の行が admin/editor には従来どおり操作できる', () => {
  it('代理店モードのトグルを押すと更新される', () => {
    render(<AgencySettings orgId="org-1" spaceId="space-1" />)
    fireEvent.click(screen.getByRole('switch', { name: '代理店モードを有効にする' }))
    expect(mockUpdate).toHaveBeenCalledWith({ agency_mode: false })
  })
})

describe('AgencySettings — 操作できない人（閲覧者・行が無い社内メンバー等）には出さない', () => {
  it('代理店モードのトグルが disabled になり、押しても更新されない', () => {
    canEditMoney = false
    render(<AgencySettings orgId="org-1" spaceId="space-1" />)
    const toggle = screen.getByRole('switch', { name: '代理店モードを有効にする' })
    expect(toggle).toBeDisabled()

    fireEvent.click(toggle)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('マージン率の入力欄が disabled になる', () => {
    canEditMoney = false
    render(<AgencySettings orgId="org-1" spaceId="space-1" />)
    expect(screen.getByLabelText('デフォルトマージン率')).toBeDisabled()
  })

  it('ベンダーポータル設定のトグルも disabled になる', () => {
    canEditMoney = false
    render(<AgencySettings orgId="org-1" spaceId="space-1" />)
    expect(screen.getByRole('switch', { name: 'クライアント名をベンダーに表示' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'ベンダーからクライアントへのコメントを許可' })).toBeDisabled()
  })
})

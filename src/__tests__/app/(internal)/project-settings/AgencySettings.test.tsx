import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgencySettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/AgencySettings'

// 代理店モードの設定(spaces.agency_mode 等)は DB の書き込み判定(app_can_write_space)と同じく
// 社内の編集者(admin/editor)だけができる。閲覧者(viewer)には出したままにせず、操作できなくする。

const mockUpdate = vi.fn().mockResolvedValue(undefined)
let mockData = {
  agency_mode: true,
  default_margin_rate: 35,
  vendor_settings: { show_client_name: false, allow_client_comments: false },
}

vi.mock('@/lib/hooks/useAgencyMode', () => ({
  useAgencyMode: () => ({ data: mockData, loading: false, update: mockUpdate }),
}))

let canEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit, loading: false }),
}))

beforeEach(() => {
  mockUpdate.mockClear()
  canEdit = true
  mockData = {
    agency_mode: true,
    default_margin_rate: 35,
    vendor_settings: { show_client_name: false, allow_client_comments: false },
  }
})

describe('AgencySettings — 編集できる人（admin/editor）には従来どおり操作できる', () => {
  it('代理店モードのトグルを押すと更新される', () => {
    render(<AgencySettings spaceId="space-1" />)
    fireEvent.click(screen.getByRole('switch', { name: '代理店モードを有効にする' }))
    expect(mockUpdate).toHaveBeenCalledWith({ agency_mode: false })
  })
})

describe('AgencySettings — 閲覧者（viewer）には操作させない', () => {
  it('代理店モードのトグルが disabled になり、押しても更新されない', () => {
    canEdit = false
    render(<AgencySettings spaceId="space-1" />)
    const toggle = screen.getByRole('switch', { name: '代理店モードを有効にする' })
    expect(toggle).toBeDisabled()

    fireEvent.click(toggle)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('マージン率の入力欄が disabled になる', () => {
    canEdit = false
    render(<AgencySettings spaceId="space-1" />)
    expect(screen.getByLabelText('デフォルトマージン率')).toBeDisabled()
  })

  it('ベンダーポータル設定のトグルも disabled になる', () => {
    canEdit = false
    render(<AgencySettings spaceId="space-1" />)
    expect(screen.getByRole('switch', { name: 'クライアント名をベンダーに表示' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'ベンダーからクライアントへのコメントを許可' })).toBeDisabled()
  })
})

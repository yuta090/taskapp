import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DangerSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/DangerSettings'

let members = [
  { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
]
let isArchived = false
const archive = vi.fn()
const unarchive = vi.fn()

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members, loading: false, isPending: false }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' } }),
}))

vi.mock('@/lib/hooks/useSpaceName', () => ({
  useSpaceName: () => 'サイト制作',
}))

vi.mock('@/lib/hooks/useSpaceArchive', () => ({
  useSpaceArchive: () => ({ isArchived, archive, unarchive }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  archive.mockReset().mockResolvedValue(undefined)
  unarchive.mockReset().mockResolvedValue(undefined)
  isArchived = false
  members = [{ id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' }]
})

describe('DangerSettings（危険設定）', () => {
  it('管理者にはアーカイブのボタンが出る', () => {
    render(<DangerSettings spaceId="s1" />)

    expect(screen.getByRole('button', { name: /アーカイブする/ })).toBeInTheDocument()
  })

  it('管理者以外には操作を出さない', () => {
    members = [{ id: 'u1', displayName: '自分', avatarUrl: null, role: 'editor' }]
    render(<DangerSettings spaceId="s1" />)

    expect(screen.queryByRole('button', { name: /アーカイブする/ })).not.toBeInTheDocument()
    expect(screen.getByText(/管理者のみ/)).toBeInTheDocument()
  })

  it('プロジェクト名を正しく入力しないとアーカイブできない', async () => {
    render(<DangerSettings spaceId="s1" />)

    fireEvent.click(screen.getByRole('button', { name: /アーカイブする/ }))

    const confirmButton = screen.getByRole('button', { name: /^アーカイブする$/ })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('サイト制作'), { target: { value: 'サイト制作' } })

    await waitFor(() => expect(confirmButton).not.toBeDisabled())
    fireEvent.click(confirmButton)
    await waitFor(() => expect(archive).toHaveBeenCalled())
  })

  it('アーカイブ済みなら解除のボタンを出す', () => {
    isArchived = true
    render(<DangerSettings spaceId="s1" />)

    expect(screen.getByRole('button', { name: /アーカイブを解除する/ })).toBeInTheDocument()
  })
})

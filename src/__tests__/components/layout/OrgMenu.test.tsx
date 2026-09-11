import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OrgMenu } from '@/components/layout/OrgMenu'

/**
 * OrgMenu のログアウト導線。あらゆるログアウト経路を signOutAndLeave() に集約する修正
 * （LeftNav.tsx / PortalLeftNav.tsx と同じ方針）の回帰テスト。
 * signOutAndLeave 自身が window.location.replace でフルページ遷移するため、ここで
 * router.push/replace を呼んではいけない。
 */

const { mockSignOutAndLeave } = vi.hoisted(() => ({
  mockSignOutAndLeave: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

describe('OrgMenu — ログアウトは signOutAndLeave に集約する', () => {
  beforeEach(() => {
    mockSignOutAndLeave.mockClear()
  })

  it('ログアウトを押すと signOutAndLeave({ to: "/login" }) を呼ぶ', async () => {
    render(<OrgMenu isOpen onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'ログアウト' }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/login' })
    })
  })

  it('isOpen が false のときは何もレンダリングしない', () => {
    const { container } = render(<OrgMenu isOpen={false} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

// ログイン中の人の役割をテストごとに差し替える
let myRole = 'editor'

const rpcMembers = () => [
  { user_id: 'u1', display_name: '自分', avatar_url: null, role: myRole },
  { user_id: 'u2', display_name: '田中', avatar_url: null, role: 'editor' },
]

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
    },
    rpc: vi.fn().mockImplementation(async () => ({ data: rpcMembers(), error: null })),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    })),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
}))

beforeEach(() => {
  myRole = 'editor'
})

describe('MembersSettings — 招待できる人', () => {
  it('編集者でもメンバーを招待できる', async () => {
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /招待/ })).toBeInTheDocument()
  })

  it('編集者には役割の変更・削除は出さない', async () => {
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('田中')).toBeInTheDocument())
    expect(screen.queryByTitle('メンバーを削除')).not.toBeInTheDocument()
  })

  it('管理者は役割の変更・削除もできる', async () => {
    myRole = 'admin'
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('田中')).toBeInTheDocument())
    expect(screen.getByTitle('メンバーを削除')).toBeInTheDocument()
    expect(screen.getByText('メンバーを招待')).toBeInTheDocument()
  })

  it('閲覧者には招待フォームを出さない', async () => {
    myRole = 'viewer'
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('田中')).toBeInTheDocument())
    expect(screen.queryByText('メンバーを招待')).not.toBeInTheDocument()
    expect(screen.getByText(/管理者のみ/)).toBeInTheDocument()
  })
})

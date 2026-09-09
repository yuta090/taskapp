import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

// 権限判定は共有キャッシュ（['currentUser'] / ['spaceMembers']）から取る
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: rpcMembers().map((m) => ({
      id: m.user_id,
      displayName: m.display_name,
      avatarUrl: m.avatar_url,
      role: m.role,
    })),
    loading: false,
    isPending: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/shared', async () => {
  // Hint（「?」の補足）は実物を使う。確認ダイアログだけ差し替える
  const { Hint } = await import('@/components/shared/Hint')
  return {
    Hint,
    useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
  }
})

beforeEach(() => {
  myRole = 'editor'
})

describe('MembersSettings — 招待できる人', () => {
  it('編集者でもメンバーを招待できる', async () => {
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '招待' })).toBeInTheDocument()
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

describe('MembersSettings — 役割の説明ヒント', () => {
  it('招待の役割に「?」があり、押すと各役割でできることが出る', async () => {
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    const hint = screen.getByRole('button', { name: '招待する役割の補足' })
    fireEvent.click(hint)

    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('メンバー')
    expect(note).toHaveTextContent('クライアント')
    expect(note).toHaveTextContent('編集者')
  })

  it('メンバー一覧の「?」で全ての役割ができることを説明する', async () => {
    render(<MembersSettings orgId="o1" spaceId="s1" />)

    await waitFor(() => expect(screen.getByText('田中')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '役割ごとにできることの補足' }))

    const note = screen.getByRole('note')
    for (const label of ['管理者', '編集者', '閲覧者', 'クライアント', 'ベンダー']) {
      expect(note).toHaveTextContent(label)
    }
  })
})

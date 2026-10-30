import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { toast } from 'sonner'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

// ログイン中の人の役割をテストごとに差し替える
let myRole = 'editor'

// 「そのまま追加」で使う共有のモック（createClient はコンポーネントの中で呼ばれるので、外に出して見る）
const { rpcMock, refetchMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  refetchMock: vi.fn(),
}))

const rpcMembers = () => [
  { user_id: 'u1', display_name: '自分', avatar_url: null, role: myRole },
  { user_id: 'u2', display_name: '田中', avatar_url: null, role: 'editor' },
]

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
    },
    rpc: rpcMock,
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

// 参加日は一覧とは別のクエリ。ここでは中身を見ないので空で返す
vi.mock('@/lib/hooks/useSpaceMemberJoinedAt', () => ({
  useSpaceMemberJoinedAt: () => null,
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
    error: null,
    refetch: refetchMock,
    patchMembers: vi.fn(() => () => {}),
  }),
}))

// RC-2: 役割の選択肢の絞り込み（spaceRoles.test.ts / MembersSettings.roleOptions.test.tsx で
// 別途検証済み）。ここでは招待フォーム・役割の説明ヒントの表示だけを見るので、
// 誰でも「社内」役割を選べる状態に固定する（実際の react-query は使わない）
vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: () => ({ space: { agency_mode: false }, isPending: false }),
}))
vi.mock('@/lib/hooks/useOrgMembers', () => ({
  useOrgMembers: () => ({
    members: [],
    roleByUserId: new Map([
      ['u1', 'owner'],
      ['u2', 'member'],
    ]),
    emailByUserId: new Map<string, string>(),
    isPending: false,
    isLoadingError: false,
    error: null,
  }),
}))
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: [{ id: 's1', role: 'admin' }], isPending: false, isLoadingError: false }),
}))

// 招待メールの文面・招待の一覧は、開いたときだけ読みに行く（このテストでは開かない）
vi.mock('@/lib/hooks/useInviteTemplate', () => ({
  useInviteTemplate: () => ({ template: null, loading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('@/lib/hooks/useSpaceInvites', () => ({
  useSpaceInvites: () => ({ invites: [], canManage: true, loading: false, error: null, refresh: vi.fn() }),
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
  rpcMock.mockReset()
  rpcMock.mockImplementation(async () => ({ data: rpcMembers(), error: null }))
  refetchMock.mockReset()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
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

describe('MembersSettings — 組織のメンバーをそのまま追加', () => {
  const ORG_MEMBER_RESPONSE = {
    ok: false,
    status: 409,
    json: async () => ({
      error: '組織のメンバーです。招待メールは送らずに、このプロジェクトへ追加できます',
      code: 'org_member',
    }),
  }

  // メールを入れて「招待」を押し、409 org_member でパネルを開くところまで進める
  async function openPanel(email = 'miyata@example.com') {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ORG_MEMBER_RESPONSE))
    render(<MembersSettings orgId="o1" spaceId="s1" />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: email } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))
    return screen.findByTestId('add-org-member-panel')
  }

  function roleValues(panel: HTMLElement): string[] {
    return within(panel)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
  }

  it('409 org_member ではエラーの toast を出さず、追加のパネルを開く', async () => {
    const panel = await openPanel()

    expect(panel).toHaveTextContent('miyata@example.com は組織のメンバーです')
    expect(panel).toHaveTextContent('招待メールは送らずに、このプロジェクトへ追加します')
    expect(toast.error).not.toHaveBeenCalled()
    expect(within(panel).getByRole('button', { name: '追加' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'やめる' })).toBeInTheDocument()
  })

  it('編集者の選択肢に管理者は無く、既定は編集者', async () => {
    myRole = 'editor'
    const panel = await openPanel()

    expect(roleValues(panel)).toEqual(['editor', 'viewer'])
    expect(within(panel).getByRole('combobox')).toHaveValue('editor')
  })

  it('管理者の選択肢には管理者がある', async () => {
    myRole = 'admin'
    const panel = await openPanel()

    expect(roleValues(panel)).toEqual(['admin', 'editor', 'viewer'])
    expect(within(panel).getByRole('combobox')).toHaveValue('editor')
  })

  it('相手先の招待（クライアント）なら選択肢はクライアントだけ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ORG_MEMBER_RESPONSE))
    render(<MembersSettings orgId="o1" spaceId="s1" />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'c@example.com' } })
    fireEvent.change(screen.getByLabelText('役割'), { target: { value: 'client' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))
    const panel = await screen.findByTestId('add-org-member-panel')

    expect(roleValues(panel)).toEqual(['client'])
  })

  it('「追加」で rpc を呼び、成功したら toast・一覧の取り直し・パネルを閉じる・入力を空にする', async () => {
    myRole = 'admin'
    const panel = await openPanel()
    rpcMock.mockClear()
    rpcMock.mockImplementation(async () => ({ data: { ok: true, user_id: 'u9', role: 'viewer' }, error: null }))

    fireEvent.change(within(panel).getByRole('combobox'), { target: { value: 'viewer' } })
    fireEvent.click(within(panel).getByRole('button', { name: '追加' }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('miyata@example.com をプロジェクトに追加しました')
    )
    expect(rpcMock).toHaveBeenCalledWith('rpc_add_space_member_by_email', {
      p_space_id: 's1',
      p_email: 'miyata@example.com',
      p_role: 'viewer',
    })
    expect(refetchMock).toHaveBeenCalled()
    expect(screen.queryByTestId('add-org-member-panel')).not.toBeInTheDocument()
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('')
    expect(screen.getByLabelText('名前（任意）')).toHaveValue('')
  })

  it('rpc が already in space で失敗したら「このプロジェクトのメンバーです」', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const panel = await openPanel()
    rpcMock.mockImplementation(async () => ({ data: null, error: { message: 'already in space' } }))

    fireEvent.click(within(panel).getByRole('button', { name: '追加' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('このプロジェクトのメンバーです'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('rpc が日本語の理由で失敗したらそのまま見せ、英語のときは一律の文言にする', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const panel = await openPanel()

    rpcMock.mockImplementation(async () => ({
      data: null,
      error: { message: '管理者の役割を付けられるのは、プロジェクトの管理者だけです' },
    }))
    fireEvent.click(within(panel).getByRole('button', { name: '追加' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('管理者の役割を付けられるのは、プロジェクトの管理者だけです')
    )

    rpcMock.mockImplementation(async () => ({ data: null, error: { message: 'MFA required' } }))
    fireEvent.click(within(panel).getByRole('button', { name: '追加' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('メンバーの追加に失敗しました'))
    consoleError.mockRestore()
  })

  it('メール欄を書き換えるとパネルが閉じる', async () => {
    await openPanel()

    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'other@example.com' } })

    expect(screen.queryByTestId('add-org-member-panel')).not.toBeInTheDocument()
  })

  it('「やめる」でパネルが閉じる', async () => {
    const panel = await openPanel()

    fireEvent.click(within(panel).getByRole('button', { name: 'やめる' }))

    expect(screen.queryByTestId('add-org-member-panel')).not.toBeInTheDocument()
  })
})

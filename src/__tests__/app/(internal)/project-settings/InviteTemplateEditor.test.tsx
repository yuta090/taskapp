import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

/**
 * 招待フォームでの「送るメールの文面」の確認・その場編集・テンプレート保存。
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
}))

// 招待の一覧はタブを開いたときだけ読みに行く
vi.mock('@/lib/hooks/useSpaceInvites', () => ({
  useSpaceInvites: () => ({ invites: [], canManage: true, loading: false, error: null, refresh: vi.fn() }),
}))

const mockGetUser = vi.fn()
const mockRpc = vi.fn()
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}))

const BASE_FIELDS = {
  subject: '【AgentPM】{{組織名}} のチームに招待されました',
  heading: 'チームへの招待',
  body: '{{招待者名}} さんが招待しました。',
  cta_label: '招待を承諾する',
  note: '',
}

let template: { fields: typeof BASE_FIELDS; source: string; canSaveTemplate: boolean } | null
let templateLoading = false
const useInviteTemplateMock = vi.fn()
const refreshTemplateMock = vi.fn()
vi.mock('@/lib/hooks/useInviteTemplate', () => ({
  useInviteTemplate: (...args: unknown[]) => {
    useInviteTemplateMock(...args)
    return { template, loading: templateLoading, error: null, refresh: refreshTemplateMock }
  },
}))

const fetchMock = vi.fn()

function lastInviteBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/invites')
  return JSON.parse((call?.[1] as { body: string }).body)
}

async function openEditor() {
  render(<MembersSettings orgId="org-1" spaceId="space-1" />)
  await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /送るメールの文面/ }))
  await waitFor(() => expect(screen.getByLabelText('件名')).toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  template = { fields: { ...BASE_FIELDS }, source: 'code', canSaveTemplate: true }
  templateLoading = false

  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockFrom.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) })
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'rpc_get_space_members') {
      return Promise.resolve({
        data: [{ user_id: 'user-1', display_name: '自分', avatar_url: null, role: 'admin' }],
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  })

  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: 'tok', email_sent: true }) })
  vi.stubGlobal('fetch', fetchMock)
})

describe('招待フォーム: 送るメールの文面', () => {
  it('開くと、いま使われている文面がそのまま出る', async () => {
    await openEditor()

    expect((screen.getByLabelText('件名') as HTMLInputElement).value).toBe(BASE_FIELDS.subject)
    expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe(BASE_FIELDS.body)
  })

  it('閉じているあいだは文面を取りに行かない', async () => {
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    expect(useInviteTemplateMock).toHaveBeenCalledWith('space-1', 'member', false)
  })

  it('直した文面が招待に載る', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('件名'), { target: { value: '直した件名' } })
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/invites', expect.anything()))
    const body = lastInviteBody()
    expect((body.template as Record<string, string>).subject).toBe('直した件名')
    expect(body.save_as_template).toBeUndefined()
  })

  it('直していなければ文面は載せない', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/invites', expect.anything()))
    expect(lastInviteBody().template).toBeUndefined()
  })

  it('「テンプレートとして保存する」を選ぶと保存も頼む', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '新しい本文' } })
    fireEvent.click(screen.getByLabelText(/テンプレートとして保存する/))
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/invites', expect.anything()))
    const body = lastInviteBody()
    expect(body.save_as_template).toBe(true)
    expect((body.template as Record<string, string>).body).toBe('新しい本文')
  })

  it('事務所の管理者でなければ保存は選べない', async () => {
    template = { fields: { ...BASE_FIELDS }, source: 'code', canSaveTemplate: false }
    await openEditor()

    expect(screen.getByLabelText(/テンプレートとして保存する/)).toBeDisabled()
    expect(screen.getByText(/事務所の管理者/)).toBeInTheDocument()
  })

  it('役割を変えると、その役割の文面に切り替える', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('役割'), { target: { value: 'client' } })

    await waitFor(() => expect(useInviteTemplateMock).toHaveBeenCalledWith('space-1', 'client', true))
  })

  it('直した文面は役割ごとに別々に覚えておく', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('件名'), { target: { value: 'メンバー用に直した件名' } })

    fireEvent.change(screen.getByLabelText('役割'), { target: { value: 'client' } })
    await waitFor(() => expect((screen.getByLabelText('件名') as HTMLInputElement).value).toBe(BASE_FIELDS.subject))

    fireEvent.change(screen.getByLabelText('役割'), { target: { value: 'member' } })
    await waitFor(() =>
      expect((screen.getByLabelText('件名') as HTMLInputElement).value).toBe('メンバー用に直した件名')
    )
  })

  it('「元に戻す」で編集を捨てられる', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('件名'), { target: { value: '直した件名' } })
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))

    expect((screen.getByLabelText('件名') as HTMLInputElement).value).toBe(BASE_FIELDS.subject)
  })

  it('招待を送ったら、その場の編集は消える（次の人に持ち越さない）', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('件名'), { target: { value: '直した件名' } })
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() =>
      expect((screen.getByLabelText('件名') as HTMLInputElement).value).toBe(BASE_FIELDS.subject)
    )
  })

  it('事務所で保存した文面のときだけ「標準の文面に戻す」が出て、消せる', async () => {
    template = { fields: { ...BASE_FIELDS }, source: 'org', canSaveTemplate: true }
    await openEditor()

    fireEvent.click(screen.getByRole('button', { name: '標準の文面に戻す' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/invites/template?space_id=space-1&role=member',
        expect.objectContaining({ method: 'DELETE' })
      )
    )
    expect(refreshTemplateMock).toHaveBeenCalled()
  })

  it('標準の文面のときは「標準の文面に戻す」を出さない', async () => {
    await openEditor()

    expect(screen.queryByRole('button', { name: '標準の文面に戻す' })).toBeNull()
  })
})

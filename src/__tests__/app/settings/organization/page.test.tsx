import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import OrganizationSettingsPage from '@/app/settings/organization/page'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

/**
 * org_channel_policy.due_reminders_enabled の取得は引き続き直接select、更新は
 * rpc_set_org_due_reminders_enabled（別担当がRPC方式へ作り直し中の20260721215120）経由に変更。
 * 行が無い/nullはfail-open(true)＝既定有効（サーバ側coalesceと同じ規約）を確認するテストのため、
 * policyResponse/policyErrorを各itで差し替えられるようにする。
 */
let policyResponse: { data: unknown; error: unknown } = { data: null, error: null }
const rpcMock = vi.fn((...args: unknown[]) => {
  void args
  return Promise.resolve<{ error: { message: string } | null }>({ error: null })
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'org_channel_policy') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(policyResponse),
            }),
          }),
        }
      }
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}))

describe('OrganizationSettingsPage management links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    policyResponse = { data: null, error: null }

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })
  })

  it('shows a management section with links to members, org integrations, and billing', () => {
    render(<OrganizationSettingsPage />)

    expect(screen.getByText('組織の管理')).toBeInTheDocument()

    const membersLink = screen.getByRole('link', { name: /メンバー管理/ })
    expect(membersLink).toHaveAttribute('href', '/settings/members')

    const integrationsLink = screen.getByRole('link', { name: /組織の外部連携/ })
    expect(integrationsLink).toHaveAttribute('href', '/settings/org-integrations')

    const billingLink = screen.getByRole('link', { name: /プランと請求/ })
    expect(billingLink).toHaveAttribute('href', '/settings/billing')
  })
})

describe('AI秘書の自動期限リマインド トグル（org_channel_policy.due_reminders_enabled・事務所単位オンオフ）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    policyResponse = { data: null, error: null }

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })
  })

  it('行が無ければfail-open(既定オン)で表示する', async () => {
    render(<OrganizationSettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
    await waitFor(() => expect(checkbox).toBeChecked())
  })

  it('due_reminders_enabled=falseなら初期表示はオフになる', async () => {
    policyResponse = { data: { due_reminders_enabled: false }, error: null }
    render(<OrganizationSettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
    await waitFor(() => expect(checkbox).not.toBeChecked())
  })

  it('ownerはトグルを操作でき、楽観的更新のうえrpc_set_org_due_reminders_enabledを呼ぶ（保存ボタン無し）', async () => {
    render(<OrganizationSettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
    await waitFor(() => expect(checkbox).toBeChecked())

    fireEvent.click(checkbox)

    // 楽観的更新: クリック直後に即オフ表示になる
    expect(checkbox).not.toBeChecked()

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('rpc_set_org_due_reminders_enabled', {
        p_org_id: 'org-123',
        p_enabled: false,
      })
    })
  })

  it('低: 保存中(in-flight)は再クリックしても2本目のRPCを飛ばさない（連打ガード）', async () => {
    let resolveRpc: (value: { error: null }) => void = () => {}
    rpcMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve
        }),
    )
    render(<OrganizationSettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
    await waitFor(() => expect(checkbox).toBeChecked())

    fireEvent.click(checkbox) // 1回目: RPCがpendingのまま
    fireEvent.click(checkbox) // 2回目: in-flightなので無視されるべき

    expect(rpcMock).toHaveBeenCalledTimes(1)
    // in-flight中はdisabledになる
    expect(checkbox).toBeDisabled()

    resolveRpc({ error: null })
    await waitFor(() => expect(checkbox).not.toBeDisabled())
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('rpc失敗時はロールバックし、エラーを表示する', async () => {
    rpcMock.mockResolvedValueOnce({ error: { message: 'permission denied' } })
    render(<OrganizationSettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
    await waitFor(() => expect(checkbox).toBeChecked())

    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()

    await waitFor(() => expect(checkbox).toBeChecked())
    expect(
      screen.getByText('保存に失敗しました。もう一度お試しください。'),
    ).toBeInTheDocument()
  })

  it('owner以外は操作できない(disabled)・注記を表示する', async () => {
    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'member',
      loading: false,
      error: null,
    })
    render(<OrganizationSettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('オーナーのみ変更できます')).toBeInTheDocument()

    fireEvent.click(checkbox)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('補足文言に事務所全体で停止する旨・個人設定への言及・手動リマインド不停止の注記を含む（MEDIUM-2是正）', () => {
    render(<OrganizationSettingsPage />)
    expect(screen.getByText('AI秘書の自動期限リマインド')).toBeInTheDocument()
    const note = screen.getByText(
      /オフにすると、この事務所全体で自動期限リマインドを停止します/,
    )
    expect(note.textContent).toContain('個人ごとの受信オフは各自の設定で')
    expect(note.textContent).toContain('日時を指定した手動リマインドは停止しません')
  })

  describe('HIGH-1是正: 取得失敗時はfail-open表示せず、disabled＋エラー表示にする', () => {
    it('取得(select)が失敗したらトグルをdisabledのままにし、エラーを表示する（既定ON表示のまま操作可能にしない）', async () => {
      policyResponse = { data: null, error: { message: 'permission denied for column' } }
      render(<OrganizationSettingsPage />)

      const checkbox = await screen.findByRole('checkbox', { name: '自動期限リマインドを使う' })
      await waitFor(() => expect(checkbox).toBeDisabled())
      expect(
        screen.getByText('設定を読み込めませんでした。時間をおいて再度お試しください。'),
      ).toBeInTheDocument()

      fireEvent.click(checkbox)
      expect(rpcMock).not.toHaveBeenCalled()
    })
  })
})

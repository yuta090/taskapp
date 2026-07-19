import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GroupApproverRow } from '@/app/(internal)/[orgId]/secretary/approvals/ApprovalsClient'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ internalMembers: [], loading: false }),
}))

const baseGroup = {
  groupId: '11111111-1111-1111-1111-111111111111',
  displayName: 'テスト顧問先',
  spaceId: '22222222-2222-2222-2222-222222222222',
  spaceName: 'テスト顧問先',
  approverUserId: null,
  pickupMode: 'all' as const,
}

describe('GroupApproverRow — 取り込みモード選択（②課金導線）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('未解禁 org では「両方」オプションが無効化され pro印が付く', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<GroupApproverRow orgId="org-1" group={baseGroup} dualModeEntitled={false} />)
    const both = screen.getByRole('option', { name: /両方.*pro以上/ }) as HTMLOptionElement
    expect(both.disabled).toBe(true)
  })

  it('解禁 org では「両方」オプションが選択可能', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<GroupApproverRow orgId="org-1" group={baseGroup} dualModeEntitled={true} />)
    const both = screen.getByRole('option', { name: /両方/ }) as HTMLOptionElement
    expect(both.disabled).toBe(false)
    expect(screen.queryByText(/pro以上/)).not.toBeInTheDocument()
  })

  it('モード変更で PATCH /api/channels/groups を pickupMode 付きで呼ぶ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<GroupApproverRow orgId="org-1" group={baseGroup} dualModeEntitled={true} />)
    fireEvent.change(screen.getByLabelText('取り込みモード'), { target: { value: 'mention_only' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body)).toMatchObject({ pickupMode: 'mention_only', groupId: baseGroup.groupId })
  })

  it('サーバが 403 plan_required を返したら楽観更新をロールバックしエラー通知する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'plan_required', feature: 'line_pickup_dual_mode' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    // 解禁扱いでUI上は選べるが、サーバが失効を検知して 403 を返すケース
    render(<GroupApproverRow orgId="org-1" group={baseGroup} dualModeEntitled={true} />)
    const select = screen.getByLabelText('取り込みモード') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'all_plus_instant' } })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(select.value).toBe('all') // ロールバック
  })
})

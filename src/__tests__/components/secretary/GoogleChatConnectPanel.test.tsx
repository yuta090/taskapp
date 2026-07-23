import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GoogleChatConnectPanel } from '@/components/secretary/GoogleChatConnectPanel'

/**
 * Google Chat 接続パネル（PR-e・全5PR完了分）。
 * platform共有bot方式のため資格情報フォームは出さず、設定ガイド＋合言葉発行のみを担う。
 * 発行APIは PR-b で channel 対応済みの POST /api/channels/group-claims/issue
 * （body: {orgId, spaceId, channel:'google_chat'}）をそのまま叩く。
 */

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [
      { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      { id: 'space-2', name: '他org', orgId: 'org-OTHER', orgName: '別事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 1 },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

function mockIssue(res: { ok: boolean; status?: number; body: unknown }) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/api/channels/group-claims/issue') && init?.method === 'POST') {
      return Promise.resolve({ ok: res.ok, status: res.status, json: () => Promise.resolve(res.body) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

describe('GoogleChatConnectPanel', () => {
  it('設定ガイドの3ステップを表示する', () => {
    mockIssue({ ok: true, body: {} })
    render(<GoogleChatConnectPanel orgId={ORG} />)

    expect(screen.getByText(/運営のGoogle Chatアプリを/)).toBeInTheDocument()
    expect(screen.getByText(/Workspace管理者が権限を一度だけ承認/)).toBeInTheDocument()
    expect(screen.getByText(/@bot をメンションして/)).toBeInTheDocument()
  })

  it('プロジェクト選択肢は自org分のみ（他orgのspaceは出さない）', () => {
    mockIssue({ ok: true, body: {} })
    render(<GoogleChatConnectPanel orgId={ORG} />)

    expect(screen.getByText('山田商事')).toBeInTheDocument()
    expect(screen.queryByText('他org')).not.toBeInTheDocument()
  })

  it('space選択→発行すると、channel:google_chat で叩かれコードが表示されコピーできる', async () => {
    mockIssue({
      ok: true,
      body: { id: 'claim-1', code: 'GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234', expiresAt: '2026-07-23T00:30:00.000Z' },
    })
    render(<GoogleChatConnectPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('合言葉を発行'))

    await waitFor(() => {
      expect(screen.getByText('GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')).toBeInTheDocument()
    })

    const [, init] = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/channels/group-claims/issue'))!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      orgId: ORG,
      spaceId: 'space-1',
      channel: 'google_chat',
    })

    fireEvent.click(screen.getByText('コピー'))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')
    })
  })

  it('402 external_chat_channels_required 時はProプラン導線を表示する', async () => {
    mockIssue({ ok: false, status: 402, body: { error: 'x', code: 'external_chat_channels_required' } })
    render(<GoogleChatConnectPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('合言葉を発行'))

    await waitFor(() => {
      expect(screen.getByText(/Pro プランで使えます/)).toBeInTheDocument()
    })
    expect(screen.getByText('プランを見る')).toHaveAttribute('href', '/settings/billing')
  })

  it('402 group_limit_reached 時は上限メッセージを表示する', async () => {
    mockIssue({ ok: false, status: 402, body: { error: 'x', code: 'group_limit_reached', limit: 3 } })
    render(<GoogleChatConnectPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('合言葉を発行'))

    await waitFor(() => {
      expect(screen.getByText(/上限に達しています/)).toBeInTheDocument()
    })
  })

  it('その他のエラーは汎用エラーメッセージを表示する', async () => {
    mockIssue({ ok: false, status: 500, body: { error: '合言葉の発行に失敗しました' } })
    render(<GoogleChatConnectPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('合言葉を発行'))

    await waitFor(() => {
      expect(screen.getByText('合言葉の発行に失敗しました')).toBeInTheDocument()
    })
  })
})

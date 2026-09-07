import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SlackSelfLinkPanel } from '@/components/secretary/SlackSelfLinkPanel'

/**
 * 自分の Slack を AgentPM のユーザーに結びつけるカード（LINE の SelfLinkPanel の Slack 版）。
 *
 * これが無いと、Slack のリマインドに付く [完了した] などのボタンを押しても「誰が押したか」が
 * 分からず反応しない（RPC は口座×Slack user id から本人を解決する）。コードは自分の分しか
 * 発行できず（API がセッションから user_id を導出）、秘書への DM に送って成立させる。
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '33333333-3333-4333-8333-333333333333'

let accountState: { data: unknown; isPending: boolean; refetch: () => void }
vi.mock('@/lib/hooks/useOrgChannelAccount', () => ({
  useOrgChannelAccount: () => accountState,
}))

const fetchMock = vi.fn()

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function mockApis({ links = [] }: { links?: unknown[] } = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/api/channels/user-links/code')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'TA-0123456789ABCDEFGHJKMNPQ', expiresInMinutes: 15 }) })
    }
    if (url.includes('/api/channels/user-links')) {
      if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({ revoked: true }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  accountState = {
    data: { id: ACCOUNT, channel: 'slack', displayName: 'AgentPM秘書', status: 'active', createdAt: '', ownerType: 'org' },
    isPending: false,
    refetch: vi.fn(),
  }
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('SlackSelfLinkPanel', () => {
  it('鍵が未登録なら発行ボタンを出さず、先に登録するよう案内する', () => {
    accountState = { data: null, isPending: false, refetch: vi.fn() }
    mockApis()
    render(<SlackSelfLinkPanel orgId={ORG} />)
    expect(screen.getByText(/先に.*鍵を登録/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /コードを発行/ })).not.toBeInTheDocument()
  })

  it('登録済みなら「コードを発行してつなぐ」が出て、押すと Slack の口座宛てにコードを発行し、DM に送る案内を出す', async () => {
    mockApis()
    render(<SlackSelfLinkPanel orgId={ORG} />)
    const button = await screen.findByRole('button', { name: /コードを発行/ })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText('TA-0123456789ABCDEFGHJKMNPQ')).toBeInTheDocument())
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/channels/user-links/code'))
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ orgId: ORG, channelAccountId: ACCOUNT })
    // 送り先は「秘書への DM」。チャンネルに貼らない注意も出す
    expect(screen.getAllByText(/DM/).length).toBeGreaterThan(0)
    expect(screen.getByText(/チャンネルには貼らない/)).toBeInTheDocument()
  })

  it('一覧の取得中は件数を出さない（「0人」と誤って見せて再発行させない）', async () => {
    let resolveLinks: (v: unknown) => void = () => {}
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/channels/user-links')) return new Promise((r) => (resolveLinks = r))
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })
    render(<SlackSelfLinkPanel orgId={ORG} />)
    expect(screen.queryByText(/つないだ人/)).not.toBeInTheDocument()
    expect(screen.queryByText(/まだ誰もつないでいません/)).not.toBeInTheDocument()
    resolveLinks({ ok: true, json: () => Promise.resolve({ links: [] }) })
    await waitFor(() => expect(screen.getByText(/つないだ人.*0/)).toBeInTheDocument())
  })

  it('この Slack の口座の分だけをサーバー側で絞って取り（channelAccountId 付き）、解除できる', async () => {
    mockApis({
      links: [{ id: 'l-slack', userId: 'u1', channelAccountId: ACCOUNT, linkedAt: '2026-09-08T00:00:00Z' }],
    })
    render(<SlackSelfLinkPanel orgId={ORG} />)
    await waitFor(() => expect(screen.getByText(/つないだ人.*1/)).toBeInTheDocument())
    const listCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/api/channels/user-links?') && !(init as RequestInit | undefined)?.method)
    expect(String(listCall![0])).toContain(`channelAccountId=${ACCOUNT}`)
    expect(String(listCall![0])).toContain(`orgId=${ORG}`)
    const revoke = screen.getAllByRole('button', { name: /解除/ })
    expect(revoke).toHaveLength(1)
    fireEvent.click(revoke[0])
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ orgId: ORG, linkId: 'l-slack' })
    })
  })

  it('発行に失敗したらエラー文言を出す', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/channels/user-links/code')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'channel account not found in org' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links: [] }) })
    })
    render(<SlackSelfLinkPanel orgId={ORG} />)
    fireEvent.click(await screen.findByRole('button', { name: /コードを発行/ }))
    await waitFor(() => expect(screen.getByText(/channel account not found in org/)).toBeInTheDocument())
  })
})

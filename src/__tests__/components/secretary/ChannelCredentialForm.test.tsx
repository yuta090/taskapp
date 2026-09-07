import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChannelCredentialForm } from '@/components/secretary/ChannelCredentialForm'
import { CHANNELS } from '@/lib/channels/registry'

/**
 * ChannelCredentialForm — 資格情報の登録フォーム（client）。
 * registry の requiredCredentialFields を入力欄にし、POST /api/channels/accounts で保存する。
 * 生成secret(webhook_secret)と受信Webhook URLは登録レスポンスから一度だけ表示する。
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()

// 接続状態(GET /api/channels/accounts)はフック経由。既定は「未接続」。
const accountState: {
  account: Record<string, unknown> | null
  isLoading: boolean
  refetch: ReturnType<typeof vi.fn>
} = {
  account: null,
  isLoading: false,
  refetch: vi.fn(),
}
vi.mock('@/lib/hooks/useOrgChannelAccount', () => ({
  useOrgChannelAccount: () => ({
    data: accountState.account,
    isPending: accountState.isLoading,
    error: null,
    refetch: accountState.refetch,
  }),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  fetchMock.mockReset()
  accountState.account = null
  accountState.isLoading = false
  accountState.refetch = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function okResponse(json: Record<string, unknown>, status = 201) {
  return { ok: status < 400, status, json: async () => json }
}

describe('ChannelCredentialForm', () => {
  it('registry の必須フィールドを入力欄に出す（generatedは出さない）', () => {
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.telegram} />)
    expect(screen.getByTestId('cred-input-bot_token')).toBeInTheDocument()
    // webhook_secret はサーバー生成なので入力欄に出さない
    expect(screen.queryByTestId('cred-input-webhook_secret')).toBeNull()
  })

  it('送信すると orgId/channel/credentials を POST する', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ account: { id: 'acc-1' }, created: true, generatedSecrets: {}, webhookUrl: null }),
    )
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.slack} />)

    fireEvent.change(screen.getByTestId('cred-input-bot_token'), { target: { value: 'xoxb-1' } })
    fireEvent.change(screen.getByTestId('cred-input-signing_secret'), { target: { value: 'sig' } })
    fireEvent.click(screen.getByRole('button', { name: /接続|登録/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/channels/accounts')
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.orgId).toBe(ORG)
    expect(sent.channel).toBe('slack')
    expect(sent.credentials).toEqual({ bot_token: 'xoxb-1', signing_secret: 'sig' })
  })

  it('成功: 生成された webhook_secret と受信Webhook URL を表示する', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        account: { id: 'acc-1' },
        created: true,
        generatedSecrets: { webhook_secret: 'whsec_generated' },
        webhookUrl: 'http://localhost:3000/api/channels/telegram/webhook/acc-1',
      }),
    )
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.telegram} />)
    fireEvent.change(screen.getByTestId('cred-input-bot_token'), { target: { value: '123:abc' } })
    fireEvent.click(screen.getByRole('button', { name: /接続|登録/ }))

    await screen.findByText('whsec_generated')
    expect(screen.getByText('http://localhost:3000/api/channels/telegram/webhook/acc-1')).toBeInTheDocument()
  })

  it('402(Free)は Pro 案内を表示し、成功表示は出さない', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ code: 'own_line_account_required', message: 'Proプランで自社アカウントを接続できます。' }, 402),
    )
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.telegram} />)
    fireEvent.change(screen.getByTestId('cred-input-bot_token'), { target: { value: '123:abc' } })
    fireEvent.click(screen.getByRole('button', { name: /接続|登録/ }))

    await screen.findByText(/Pro/)
    expect(screen.queryByText(/受信Webhook URL/)).toBeNull()
  })

  it('必須未入力ならボタン押下でクライアント側検証エラー・fetchを呼ばない', async () => {
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.telegram} />)
    fireEvent.click(screen.getByRole('button', { name: /接続|登録/ }))
    await screen.findByText(/必須/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('接続済みなら、空のフォームではなく「接続済み」カード（表示名・登録日）を出す', () => {
    // 合鍵は暗号化して再表示しない仕様だが、毎回まっさらのフォームだけだと
    // 「つながっていない」ように見える（Slack作り直しの際に実際に誤解を招いた）。
    accountState.account = {
      id: 'acc-1',
      channel: 'slack',
      displayName: 'AgentPM秘書',
      lineBotUserId: null,
      status: 'active',
      createdAt: '2026-09-07T08:28:38.283Z',
      ownerType: 'org',
    }
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.slack} />)
    expect(screen.getByText('接続済み')).toBeInTheDocument()
    expect(screen.getByText('AgentPM秘書')).toBeInTheDocument()
    expect(screen.getByText(/2026\/9\/7/)).toBeInTheDocument()
    // 入力欄は畳んでおく
    expect(screen.queryByTestId('cred-input-bot_token')).toBeNull()
  })

  it('接続済み: 「合鍵を入れ直す」を押すと入力欄が開き、保存後は接続状態を取り直す', async () => {
    accountState.account = {
      id: 'acc-1',
      channel: 'slack',
      displayName: 'AgentPM秘書',
      lineBotUserId: null,
      status: 'active',
      createdAt: '2026-09-07T08:28:38.283Z',
      ownerType: 'org',
    }
    fetchMock.mockResolvedValue(
      okResponse({ account: { id: 'acc-1' }, created: false, generatedSecrets: {}, webhookUrl: null }, 200),
    )
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.slack} />)
    fireEvent.click(screen.getByRole('button', { name: '合鍵を入れ直す' }))
    expect(screen.getByTestId('cred-input-bot_token')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('cred-input-bot_token'), { target: { value: 'xoxb-2' } })
    fireEvent.change(screen.getByTestId('cred-input-signing_secret'), { target: { value: 'sig2' } })
    fireEvent.click(screen.getByRole('button', { name: /接続|登録|更新/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(accountState.refetch).toHaveBeenCalled())
    expect(await screen.findByText('資格情報を更新しました')).toBeInTheDocument()
  })

  it('接続状態を取得中は、空のフォームを先に見せない（接続済みなのに未接続に見える一瞬を作らない）', () => {
    accountState.isLoading = true
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.slack} />)
    expect(screen.queryByTestId('cred-input-bot_token')).toBeNull()
    expect(screen.getByText(/確認中/)).toBeInTheDocument()
  })

  it('接続済みでも無効化されていれば「無効」と分かるように出す', () => {
    accountState.account = {
      id: 'acc-1',
      channel: 'slack',
      displayName: 'AgentPM秘書',
      lineBotUserId: null,
      status: 'disabled',
      createdAt: '2026-09-07T08:28:38.283Z',
      ownerType: 'org',
    }
    render(<ChannelCredentialForm orgId={ORG} def={CHANNELS.slack} />)
    expect(screen.getByText('無効')).toBeInTheDocument()
    // 合鍵を入れ直すと有効に戻る（ローテートは status='active' を書く）ことを黙って起こさない
    expect(screen.getByText(/入れ直すと有効に戻ります/)).toBeInTheDocument()
  })
})

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

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  fetchMock.mockReset()
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
})

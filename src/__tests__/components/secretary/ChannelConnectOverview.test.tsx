import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChannelConnectOverview } from '@/components/secretary/ChannelConnectOverview'
import { CHANNELS } from '@/lib/channels/registry'

const ORG = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: [], loading: false, error: null, refetch: vi.fn() }),
}))

describe('ChannelConnectOverview', () => {
  it('Slack: 資格情報キー・送信先・開発者コンソールを表示', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('bot_token')).toBeInTheDocument()
    expect(screen.getByText('signing_secret')).toBeInTheDocument()
    const link = screen.getByText('開発者コンソールを開く').closest('a')
    expect(link).toHaveAttribute('href', CHANNELS.slack.setupUrl)
  })

  it('Teams: Pro バッジと受信Webhookパスを表示', () => {
    render(<ChannelConnectOverview def={CHANNELS.teams} orgId={ORG} />)
    expect(screen.getByText('Pro')).toBeInTheDocument()
  })

  it('Telegram: 受信=対応（inbound実装済み）と表示', () => {
    render(<ChannelConnectOverview def={CHANNELS.telegram} orgId={ORG} />)
    expect(screen.getByText('受信Webhook')).toBeInTheDocument()
    expect(screen.getByText(CHANNELS.telegram.webhookPath!)).toBeInTheDocument()
  })

  it('Slack: 資格情報フォーム(ChannelCredentialForm)を出す（従来どおり）', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    expect(screen.getByText('資格情報を登録する')).toBeInTheDocument()
    expect(screen.queryByText('つなぎ方')).not.toBeInTheDocument()
  })

  it('Google Chat: 資格情報フォームは出さず、共有Bot接続パネル(設定ガイド＋合言葉発行)を出す', () => {
    render(<ChannelConnectOverview def={CHANNELS.google_chat} orgId={ORG} />)
    expect(screen.queryByText('資格情報を登録する')).not.toBeInTheDocument()
    expect(screen.queryByText('開発者コンソールを開く')).not.toBeInTheDocument()
    expect(screen.getByText('追加の資格情報は不要です（運営が共有Botを提供します）。')).toBeInTheDocument()
    expect(screen.getByText('つなぎ方')).toBeInTheDocument()
    expect(screen.getByText(/Workspace管理者が権限を一度だけ承認/)).toBeInTheDocument()
  })

  it('Discord: 共有Bot扱いで、資格情報フォームは出さず接続パネル(合言葉発行)を出す', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    expect(screen.queryByText('資格情報を登録する')).not.toBeInTheDocument()
    expect(screen.getByText('追加の資格情報は不要です（運営が共有Botを提供します）。')).toBeInTheDocument()
    expect(screen.getByText('つなぎ方')).toBeInTheDocument()
    // Discord固有の案内（チャンネルに投稿）
    expect(screen.getByText(/チャンネルにこの合言葉を投稿/)).toBeInTheDocument()
  })
})

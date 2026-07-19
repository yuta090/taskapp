import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChannelConnectOverview } from '@/components/secretary/ChannelConnectOverview'
import { CHANNELS } from '@/lib/channels/registry'

const ORG = '11111111-1111-4111-8111-111111111111'

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
})

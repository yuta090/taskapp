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
    expect(screen.getByText('つなぎ方')).toBeInTheDocument()
    expect(screen.getByText(/Workspace管理者が権限を一度だけ承認/)).toBeInTheDocument()
  })

  it('Discord: 共有Bot扱いで、資格情報フォームは出さず接続パネル(合言葉発行)を出す', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    expect(screen.queryByText('資格情報を登録する')).not.toBeInTheDocument()
    expect(screen.getByText('つなぎ方')).toBeInTheDocument()
    // Discord固有の案内（チャンネルに投稿）
    expect(screen.getByText(/チャンネルにこの合言葉を投稿/)).toBeInTheDocument()
  })
})

/**
 * 認知負荷の是正 — 画面には「いま何をするか」だけを出し、開発者向けのメタ情報は畳む。
 * 「つなぐ」の各チャネルページは文字が多すぎて主アクションが埋もれていた。
 */
describe('ChannelConnectOverview — 主アクション優先の情報設計', () => {
  it('技術的な設定内容は既定で畳まれている', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    const details = screen.getByText('技術的な設定内容').closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
  })

  it('主アクション（資格情報フォーム）は技術的な設定内容より前に置く', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    const action = screen.getByText('資格情報を登録する')
    const details = screen.getByText('技術的な設定内容')
    // action が details より前 = details は action の後方にある
    expect(action.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('主アクション（合言葉の発行）も技術的な設定内容より前に置く', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    const action = screen.getByText('つなぎ方')
    const details = screen.getByText('技術的な設定内容')
    expect(action.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('registry の notes（開発者向けの長文メモ）は画面に出さない', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    expect(screen.queryByText(CHANNELS.slack.notes!)).not.toBeInTheDocument()
  })

  it('社内ドキュメントのファイルパスは画面に出さない', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    expect(screen.queryByText(/CHANNEL_CONNECTIONS_SETUP/)).not.toBeInTheDocument()
  })
})

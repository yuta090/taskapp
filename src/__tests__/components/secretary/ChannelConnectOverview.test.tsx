import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChannelConnectOverview } from '@/components/secretary/ChannelConnectOverview'
import { getChannelPastePlacement } from '@/lib/channels/commandGuides'
import { CHANNELS } from '@/lib/channels/registry'

const ORG = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: [], loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('@/lib/hooks/useOrgChannelAccount', () => ({
  useOrgChannelAccount: () => ({ data: null, isPending: false, refetch: vi.fn() }),
}))
// SlackSelfLinkPanel は発行/解除後に invalidateQueries するため useQueryClient を使う。
// この画面テストは Provider を張らないので、クライアントだけ差し替える。
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('@/lib/hooks/useOrgUserLinks', () => ({
  useOrgUserLinks: () => ({ data: [], isPending: false }),
  orgUserLinksQueryKey: (orgId: string, accountId?: string) => ['channelUserLinks', orgId, accountId ?? null],
}))
vi.mock('@/lib/hooks/useAccountActiveGroups', () => ({
  useAccountActiveGroups: () => ({ data: 0, isPending: false }),
}))
// 確認待ちは react-query 経由のフック。ここでは静的な描画だけを見るので固定値にする。
vi.mock('@/lib/hooks/usePendingGroupClaims', () => ({
  usePendingGroupClaims: () => ({ items: [], isLoading: false, error: null, act: vi.fn(), rowErrors: {} }),
}))

describe('ChannelConnectOverview', () => {
  it('Slack: 資格情報キー・送信先・開発者コンソールを表示', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Slack' })).toBeInTheDocument()
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

  it('Slack（自社アプリ）: 資格情報フォームに加えて、グループ紐付けの合言葉パネルも出す', () => {
    // 自社Slackアプリは「鍵を登録する」(一度)と「チャンネルごとに合言葉で紐付ける」(都度)の両方が要る。
    // 以前は合言葉を発行するUIが無く、登録できても秘書をチャンネルに紐付けられなかった。
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    expect(screen.getByText('資格情報を登録する')).toBeInTheDocument()
    expect(screen.getByText('つなぎ方')).toBeInTheDocument()
    expect(screen.getByText('合言葉の発行')).toBeInTheDocument()
    // Slack 固有の案内（/invite で秘書を招待 → 合言葉をチャンネルに投稿）— 全体案内と合言葉パネルの両方に出る
    expect(screen.getAllByText(/\/invite/).length).toBeGreaterThanOrEqual(1)
    // 自社アプリなので開発者コンソールへのリンクは残す
    expect(screen.getByText('開発者コンソールを開く')).toBeInTheDocument()
  })

  it('Slack（自社アプリ）: 全体の流れの案内が最初、鍵の登録、合言葉の発行の順に並ぶ', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    const guide = screen.getByText(/Slack に秘書を入れる手順/)
    const form = screen.getByText('資格情報を登録する')
    const claim = screen.getByText('つなぎ方')
    expect(guide.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(form.compareDocumentPosition(claim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Slack（自社アプリ）: 合言葉の発行の後に、そのチャネルの「確認待ち」を出す（LINEの画面に行かなくて済む）', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    const claim = screen.getByText('合言葉の発行')
    const pending = screen.getByText('チャンネルの承認')
    expect(claim.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Discord（共有Bot）: こちらにも「確認待ち」を出す', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    expect(screen.getByText('チャンネルの承認')).toBeInTheDocument()
  })

  it('Telegram（合言葉方式でない）: 「確認待ち」は出さない', () => {
    render(<ChannelConnectOverview def={CHANNELS.telegram} orgId={ORG} />)
    expect(screen.queryByText('チャンネルの承認')).toBeNull()
  })

  it('Google Chat / Discord には Slack の案内を出さない', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    expect(screen.queryByText(/Slack に秘書を入れる手順/)).not.toBeInTheDocument()
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

/**
 * 使い方（コマンド一覧）— 「つないだあと、そのチャットで何をどう打つのか」の案内。
 * 接続の手順（つなぎ方）とは別物なので、開発者向けの「技術的な設定内容」には入れない。
 */
describe('ChannelConnectOverview — 使い方（コマンド一覧）', () => {
  it('Discord: 使い方ボタンが出る', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    expect(screen.getByRole('button', { name: /使い方（コマンド一覧）/ })).toBeInTheDocument()
  })

  it('WhatsApp（1:1専用で案内する操作が無い）: 使い方ボタンを出さない', () => {
    render(<ChannelConnectOverview def={CHANNELS.whatsapp} orgId={ORG} />)
    expect(screen.queryByRole('button', { name: /使い方（コマンド一覧）/ })).not.toBeInTheDocument()
  })

  it('Discord（秘書のアカウントを当社が持つ）: 編集できないプロフィール欄を貼り先にしない', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: /使い方（コマンド一覧）/ }))
    expect(screen.getByText(getChannelPastePlacement('discord', 'platform')!.heading)).toBeInTheDocument()
    expect(
      screen.queryByText(getChannelPastePlacement('discord', 'org')!.heading),
    ).not.toBeInTheDocument()
  })

  it('Discord: 貼り先を、そのチャットに実在する名前（トピック）で呼ぶ', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: /使い方（コマンド一覧）/ }))
    expect(screen.getAllByText(/トピック/).length).toBeGreaterThan(0)
  })

  it('Slack（事務所が自分で登録する秘書）: これまでどおりプロフィール欄が貼り先', () => {
    render(<ChannelConnectOverview def={CHANNELS.slack} orgId={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: /使い方（コマンド一覧）/ }))
    expect(screen.getByText(getChannelPastePlacement('slack', 'org')!.heading)).toBeInTheDocument()
  })

  it('使い方ボタンは「技術的な設定内容」の中ではなく外に出す', () => {
    render(<ChannelConnectOverview def={CHANNELS.discord} orgId={ORG} />)
    const guideButton = screen.getByRole('button', { name: /使い方（コマンド一覧）/ })
    expect(guideButton.closest('details')).toBeNull()
    const details = screen.getByText('技術的な設定内容')
    // 使い方ボタンが details より前 = details は後方にある
    expect(
      guideButton.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

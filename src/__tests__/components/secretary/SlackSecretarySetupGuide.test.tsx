import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SlackSecretarySetupGuide, CHANNEL_ACCOUNT_REGISTERED_EVENT } from '@/components/secretary/SlackSecretarySetupGuide'

/**
 * Slack に AI秘書を入れる手順の案内画面。
 *
 * 背景: Slack と AgentPM を往復する手順が画面のどこにも書かれておらず、利用者（運営自身も）が
 * 迷った。「手順 / どこで / やること」を一覧で出し、いまどの手順かを示す。
 * さらに「Slack でアプリを作る」を1クリック（設定ファイル入りで Slack の作成画面を開く）にする。
 */

const ORG = '322a219f-1a73-4935-b061-08b8a5e97334'

let accountState: { data: unknown; isPending: boolean; refetch: () => void }
vi.mock('@/lib/hooks/useOrgChannelAccount', () => ({
  useOrgChannelAccount: () => accountState,
}))

describe('SlackSecretarySetupGuide', () => {
  beforeEach(() => {
    accountState = { data: null, isPending: false, refetch: vi.fn() }
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('全体の流れを「どこで」付きで一覧にする（Slack と AgentPM の往復が一目で分かる）', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    expect(screen.getByText(/Slack に秘書を入れる手順/)).toBeInTheDocument()
    // 6手順すべて
    for (const t of [
      /秘書アプリを作る/,
      /ワークスペースに入れて、2つの鍵をコピー/,
      /2つの鍵を AgentPM に登録/,
      /秘書をチャンネルに招待/,
      /合言葉を発行して、そのチャンネルに投稿/,
      /確認待ち.*承認/,
    ]) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    // どこでやるかの印
    expect(screen.getAllByText('Slack').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('AgentPM').length).toBeGreaterThanOrEqual(2)
  })

  it('「Slack でアプリを作る」は設定ファイル入りで Slack の作成画面を開く（受信URLは組織単位）', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    const link = screen.getByRole('link', { name: /Slack でアプリを作る/ })
    const url = new URL(link.getAttribute('href')!)
    expect(url.origin + url.pathname).toBe('https://api.slack.com/apps')
    expect(url.searchParams.get('new_app')).toBe('1')
    const manifest = JSON.parse(url.searchParams.get('manifest_json')!)
    expect(manifest.display_information.name).toBe('AgentPM秘書')
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      `${window.location.origin}/api/channels/slack/webhook/org/${ORG}`,
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('鍵のコピー場所と、取り違えの注意（別アプリの鍵だと動かない）を明記する', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    expect(screen.getByText(/Install App/)).toBeInTheDocument()
    expect(screen.getByText(/Bot User OAuth Token/)).toBeInTheDocument()
    expect(screen.getByText(/Basic Information/)).toBeInTheDocument()
    expect(screen.getByText(/Signing Secret/)).toBeInTheDocument()
    expect(screen.getByText(/必ず「AgentPM秘書」の画面/)).toBeInTheDocument()
  })

  it('未登録: いまここ＝手順1、手順3（登録）はまだ', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    const current = screen.getByText('いまここ')
    expect(current.closest('li')).toHaveTextContent(/秘書アプリを作る/)
  })

  it('取得中（初回・キャッシュ無し）: 本文は出すが「済み／いまここ」の印は出さない（登録済みの人に手順1を一瞬見せない）', () => {
    accountState = { data: undefined, isPending: true, refetch: vi.fn() }
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    expect(screen.getByText(/秘書アプリを作る/)).toBeInTheDocument()
    expect(screen.queryByText('いまここ')).not.toBeInTheDocument()
    expect(screen.queryByText('済み')).not.toBeInTheDocument()
  })

  it('登録済み: 手順1〜3は済み、いまここ＝手順4（招待）。登録した名前を出す', () => {
    accountState = {
      data: { id: 'acc', channel: 'slack', displayName: 'AgentPM秘書', status: 'active', createdAt: '', ownerType: 'org' },
      isPending: false,
      refetch: vi.fn(),
    }
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    expect(screen.getAllByText('済み').length).toBe(3)
    expect(screen.getByText('いまここ').closest('li')).toHaveTextContent(/秘書をチャンネルに招待/)
    expect(screen.getByText(/AgentPM秘書（登録済み）/)).toBeInTheDocument()
  })

  it('承認の手順は「確認待ち」ページへのリンクを持つ', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    const link = screen.getByRole('link', { name: /確認待ちを開く/ })
    expect(link).toHaveAttribute('href', `/${ORG}/secretary/approvals`)
  })

  it('設定ファイルをコピーできる（Slack の画面から手で貼る場合の逃げ道）', async () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /設定ファイルをコピー/ }))
    })
    const written = (navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]
    expect(JSON.parse(written).display_information.name).toBe('AgentPM秘書')
  })

  it('登録フォームが成功を知らせたら、状態を取り直して手順を進める', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CHANNEL_ACCOUNT_REGISTERED_EVENT, { detail: { orgId: ORG, channel: 'slack' } }),
      )
    })
    expect(accountState.refetch).toHaveBeenCalled()
  })

  it('Bot の名前を日本語にする方法（App Home → 表示名 → 再インストール）を案内する', () => {
    render(<SlackSecretarySetupGuide orgId={ORG} />)
    expect(screen.getByText(/App Home/)).toBeInTheDocument()
    expect(screen.getByText(/Reinstall/)).toBeInTheDocument()
  })
})

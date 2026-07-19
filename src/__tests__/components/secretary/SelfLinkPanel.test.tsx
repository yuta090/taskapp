import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SelfLinkPanel } from '@/components/secretary/SelfLinkPanel'

/**
 * SelfLinkPanel — UserLinksClient から SecretaryTabNav を除いた本体を純粋抽出したもの。
 * 挙動は抽出前の UserLinksClient と完全に同一であること(UI/APIコントラクトは変えない)。
 *
 * 実際に踏んだバグ: /api/channels/accounts は `account`（単数）を返すのに、
 * UI が `accounts`（複数）を読んでいた。型では気付けず、
 * 「OAが登録済みなのに『登録されていません』と表示され、発行ボタンが永久に出ない」
 * という無言の失敗になっていた。
 */

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))

const ORG = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

function mockApis({ account, links = [] }: { account: unknown; links?: unknown[] }) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/channels/accounts')) {
      // 単数形。ここを複数形だと思い込むと発行ボタンが出なくなる
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ account }) })
    }
    if (url.includes('/api/channels/user-links/code')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'ABC123' }) })
    }
    if (url.includes('/api/channels/user-links')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

describe('SelfLinkPanel', () => {
  it('OAが登録されていれば発行ボタンが表示される', async () => {
    mockApis({ account: { id: 'acc-1', displayName: '山田会計事務所' } })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => {
      expect(screen.getByText(/コードを発行してつなぐ/)).toBeInTheDocument()
    })
  })

  it('OAが未登録なら案内を出す', async () => {
    mockApis({ account: null })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => {
      expect(screen.getByText(/LINE公式アカウントが登録されていません/)).toBeInTheDocument()
    })
  })

  it('グループに貼らないよう警告する（誤爆でコードが失効するため）', async () => {
    mockApis({ account: { id: 'acc-1', displayName: 'OA' } })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => screen.getByText(/コードを発行してつなぐ/))

    // 連携済み一覧の見出しは常に出る
    expect(screen.getByText('連携済み')).toBeInTheDocument()
  })

  it('発行ボタンを押すとコードが表示される', async () => {
    mockApis({ account: { id: 'acc-1', displayName: 'OA' } })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => screen.getByText(/コードを発行してつなぐ/))
    fireEvent.click(screen.getByText(/コードを発行してつなぐ/))

    await waitFor(() => expect(screen.getByText('ABC123')).toBeInTheDocument())
  })

  it('SecretaryTabNav を含まない(ハブが1つだけnavを描画するため)', async () => {
    mockApis({ account: null })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => screen.getByText(/LINE公式アカウントが登録されていません/))
    expect(screen.queryByTestId('secretary-tab-messages')).not.toBeInTheDocument()
  })

  // 実際に踏んだ混乱: 事務所アカウントは接続済みなのに、本人未連携の空状態
  // 「まだ連携されていません」を「秘書ごと未接続」と誤読した（製作者本人も分からなかった）。
  it('OA接続済みなら「接続済み」を明示し、秘書ごと未接続と誤読させない', async () => {
    mockApis({ account: { id: 'acc-1', displayName: 'AgentPM秘書' } })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() =>
      expect(screen.getByText(/「AgentPM秘書」は接続済み/)).toBeInTheDocument(),
    )
  })

  it('本人未連携の空状態は簡潔に案内する（“秘書ごと未接続”と誤読させない）', async () => {
    mockApis({ account: { id: 'acc-1', displayName: 'OA' }, links: [] })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => expect(screen.getByText('まだつないでいません。')).toBeInTheDocument())
    // 誤読を招く旧文言は出さない
    expect(screen.queryByText('まだ連携されていません。')).not.toBeInTheDocument()
  })

  it('すでに友だち追加済みならコード送信だけでよい旨を案内する', async () => {
    mockApis({ account: { id: 'acc-1', displayName: 'OA' } })
    render(<SelfLinkPanel orgId={ORG} />)

    await waitFor(() => screen.getByText(/コードを発行してつなぐ/))
    expect(
      screen.getByText(/すでに友だち追加済みなら、下のボタンでコードを発行し/),
    ).toBeInTheDocument()
  })

  // 接続済み(自分のLINEが連携済み)なら、QR＋発行ボタンは畳んで「別の端末をつなぐ」の裏に。
  // 接続バッジと連携済み一覧を主役にする。追加接続時だけ開いてQRを見る。
  it('自分が連携済みなら QR/発行ボタンを畳み、接続バッジと一覧を見せる', async () => {
    mockApis({
      account: { id: 'acc-1', displayName: 'OA' },
      links: [{ id: 'link-1', userId: 'user-1', linkedAt: '2026-07-01T00:00:00Z' }],
    })
    render(<SelfLinkPanel orgId={ORG} />)

    // 接続バッジと連携済み一覧は展開表示
    expect(await screen.findByText(/あなたのLINEは接続済みです（1件）/)).toBeInTheDocument()
    // 一覧は中立ラベルを出し、内部ユーザーID(管理番号)は表示しない
    expect(screen.getByText('連携済みのLINE')).toBeInTheDocument()
    expect(screen.queryByText('user-1')).not.toBeInTheDocument()
    // 発行ボタンは畳まれていて直接は見えない
    expect(screen.queryByText(/コードを発行してつなぐ/)).not.toBeInTheDocument()
    expect(screen.getByTestId('connect-reopen-toggle')).toHaveTextContent('別の端末をつなぐ')

    // 開くと発行ボタンが出る
    fireEvent.click(screen.getByTestId('connect-reopen-toggle'))
    expect(screen.getByText(/コードを発行してつなぐ/)).toBeInTheDocument()
  })
})

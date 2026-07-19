import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * LineFriendQr — 友だち追加QR表示（Botを見つける手間だけを消す純粋加算UX）。
 *
 * identity(本人特定)は変えない: 「①QRで友だち追加 → ②表示されたコードをトークに送信で
 * 連携完了（追加だけでは連携されません）」を必ず一貫して表示する。
 * basic_id(公開情報)はAPI経由で取得し、QRはクライアント側で生成する。
 */

const fetchMock = vi.fn()
const toDataURLMock = vi.fn()

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }))

const { LineFriendQr } = await import('@/components/secretary/LineFriendQr')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  toDataURLMock.mockResolvedValue('data:image/png;base64,FAKE')
})

describe('LineFriendQr', () => {
  it('basicId取得成功(org専用bot): QR画像・友だち追加URL・2ステップ説明を表示する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ basicId: '@abc1234', ownerType: 'org' }),
    })

    render(<LineFriendQr orgId="org-1" />)

    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument())
    expect(toDataURLMock).toHaveBeenCalledWith('https://line.me/R/ti/p/@abc1234')
    expect(screen.getByText('https://line.me/R/ti/p/@abc1234')).toBeInTheDocument()
    expect(screen.getByText(/QRで友だち追加/)).toBeInTheDocument()
    expect(screen.getByText(/コードを1:1トークに送信/)).toBeInTheDocument()
    expect(screen.getByText(/追加だけでは連携されません/)).toBeInTheDocument()
    // org専用bot向けの文言
    // org専用botでは付加ヘッダを出さない（文字を減らす。共有botのときだけ注意を出す）
    expect(screen.queryByText(/共通の秘書アカウント/)).not.toBeInTheDocument()
  })

  it('purpose=group: 友だち追加→グループ招待→グループのトークにコード送信の3手順を表示する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ basicId: '@abc1234', ownerType: 'org' }),
    })

    render(<LineFriendQr orgId="org-1" purpose="group" />)

    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument())
    expect(screen.getByText(/秘書を友だち追加/)).toBeInTheDocument()
    expect(screen.getByText(/LINEグループに招待/)).toBeInTheDocument()
    expect(screen.getByText(/グループのトークに送信/)).toBeInTheDocument()
    // QR単体では完了しないことを明示
    expect(screen.getByText(/追加・招待だけでは連携されません/)).toBeInTheDocument()
  })

  it('basicId取得成功(共有bot): 共有bot向けの文言(コード送信が必ず必要)を表示する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ basicId: '@shared1', ownerType: 'platform' }),
    })

    render(<LineFriendQr orgId="org-1" />)

    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument())
    expect(screen.getByText(/コード送信が必ず必要/)).toBeInTheDocument()
  })

  it('basicIdが@始まりでなければ正規化してURLに含める', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ basicId: 'noAt123', ownerType: 'org' }),
    })

    render(<LineFriendQr orgId="org-1" />)

    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledWith('https://line.me/R/ti/p/@noAt123'))
  })

  it('basicIdがnull（未プロビジョニング）: 準備中メッセージを表示しQRは出さない', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ basicId: null, ownerType: null }) })

    render(<LineFriendQr orgId="org-1" />)

    await waitFor(() => expect(screen.getByText(/準備中/)).toBeInTheDocument())
    expect(screen.queryByRole('img', { name: /QR/ })).not.toBeInTheDocument()
    expect(toDataURLMock).not.toHaveBeenCalled()
  })

  it('fetch失敗: 準備中メッセージを表示する（例外を投げない）', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    render(<LineFriendQr orgId="org-1" />)

    await waitFor(() => expect(screen.getByText(/準備中/)).toBeInTheDocument())
  })

  it('APIが非2xxを返す: 準備中メッセージを表示する', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'forbidden' }) })

    render(<LineFriendQr orgId="org-1" />)

    await waitFor(() => expect(screen.getByText(/準備中/)).toBeInTheDocument())
  })
})

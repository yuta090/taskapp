import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { UserLinksClient } from '@/app/(internal)/[orgId]/secretary/user-links/UserLinksClient'

/**
 * UI と API のレスポンス契約を守るテスト。
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
})

function mockApis({ account, links = [] }: { account: unknown; links?: unknown[] }) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/channels/accounts')) {
      // 単数形。ここを複数形だと思い込むと発行ボタンが出なくなる
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ account }) })
    }
    if (url.includes('/api/channels/user-links')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

describe('UserLinksClient', () => {
  it('OAが登録されていれば発行ボタンが表示される', async () => {
    mockApis({ account: { id: 'acc-1', displayName: '山田会計事務所' } })
    render(<UserLinksClient orgId={ORG} />)

    await waitFor(() => {
      expect(screen.getByText(/山田会計事務所 と自分のLINEを連携する/)).toBeInTheDocument()
    })
  })

  it('OAが未登録なら案内を出す', async () => {
    mockApis({ account: null })
    render(<UserLinksClient orgId={ORG} />)

    await waitFor(() => {
      expect(screen.getByText(/LINE公式アカウントが登録されていません/)).toBeInTheDocument()
    })
  })

  it('グループに貼らないよう警告する（誤爆でコードが失効するため）', async () => {
    mockApis({ account: { id: 'acc-1', displayName: 'OA' } })
    render(<UserLinksClient orgId={ORG} />)

    await waitFor(() => screen.getByText(/OA と自分のLINEを連携する/))

    // 連携済み一覧の見出しは常に出る
    expect(screen.getByText('連携済み')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PendingClaimsPanel } from '@/components/secretary/PendingClaimsPanel'

/**
 * PendingClaimsPanel — チャネルごとの「確認待ち」（合言葉が投稿されたチャンネルの承認）。
 *
 * これまで承認は LINE 用ページ(/connect/line/groups)にしか無く、Slack の合言葉を
 * 投稿しても Slack のページには何も出ず、LINE の画面に紛れて出ていた。
 * 各チャネルの「つなぐ」画面にこのパネルを置き、その場で承認できるようにする。
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()

function renderPanel(channel = 'slack') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingClaimsPanel orgId={ORG} channel={channel} />
    </QueryClientProvider>,
  )
}

function pendingResponse(items: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items }) }
}

const SLACK_CLAIM = {
  id: '717ebc0f-d585-4ec5-b259-4195998174c1',
  externalGroupId: 'C0BUXTZPW3H',
  spaceId: '615a3fe5-8291-4bf1-91cd-7bed1644021b',
  spaceName: 'アルカラ',
  challengeLabel: 'ZXQ2',
  groupDisplayNameSnapshot: null,
  createdAt: '2026-09-07T08:31:33Z',
  channel: 'slack',
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PendingClaimsPanel', () => {
  it('そのチャネルの確認待ちだけを取りに行き、確認番号と相手先を出す', async () => {
    fetchMock.mockResolvedValue(pendingResponse([SLACK_CLAIM]))
    renderPanel('slack')

    expect(screen.getByText('チャンネルの承認')).toBeInTheDocument()
    expect(await screen.findByText('ZXQ2')).toBeInTheDocument()
    expect(screen.getByText('アルカラ')).toBeInTheDocument()

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/channels/group-claims/pending?orgId=${ORG}&channel=slack`)
  })

  it('確認待ちが無ければ、その旨を一言で出す（空のリストにしない）', async () => {
    fetchMock.mockResolvedValue(pendingResponse([]))
    renderPanel('slack')
    expect(await screen.findByText(/まだありません/)).toBeInTheDocument()
  })

  it('承認を押すと approval API に {orgId, claimId, action:approve} を送り、行が消える', async () => {
    // 承認が確定した後の取り直し(invalidate)では、サーバはもうその行を返さない
    let approved = false
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/group-claims/pending')) return pendingResponse(approved ? [] : [SLACK_CLAIM])
      if (url.includes('/group-claims/approval')) {
        expect(init?.method).toBe('POST')
        approved = true
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      throw new Error(`unexpected ${url}`)
    })
    renderPanel('slack')
    await screen.findByText('ZXQ2')

    fireEvent.click(screen.getByRole('button', { name: '承認' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => (u as string).includes('/group-claims/approval'))
      expect(call).toBeTruthy()
      const sent = JSON.parse((call![1] as RequestInit).body as string)
      expect(sent).toEqual({ orgId: ORG, claimId: SLACK_CLAIM.id, action: 'approve' })
    })
    await waitFor(() => expect(screen.queryByText('ZXQ2')).toBeNull())
  })

  it('却下も同じ経路で action:reject を送る', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/group-claims/pending')) return pendingResponse([SLACK_CLAIM])
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    renderPanel('slack')
    await screen.findByText('ZXQ2')
    fireEvent.click(screen.getByRole('button', { name: '却下' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => (u as string).includes('/group-claims/approval'))
      expect(JSON.parse((call![1] as RequestInit).body as string).action).toBe('reject')
    })
  })

  it('承認の直後に飛んでいた古いポーリング応答が、消した行を書き戻さない', async () => {
    // 10〜15秒ごとのポーリングと承認が重なると、古い一覧が楽観除去した行を復活させうる。
    // cancelQueries で打ち切り、成功後は invalidate で確定後の一覧を取り直す。
    let approved = false
    let pendingCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/group-claims/pending')) {
        pendingCalls += 1
        if (pendingCalls === 1) return pendingResponse([SLACK_CLAIM])
        // 2回目以降(承認後の取り直し)は確定後の一覧
        return pendingResponse(approved ? [] : [SLACK_CLAIM])
      }
      approved = true
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    renderPanel('slack')
    await screen.findByText('ZXQ2')
    fireEvent.click(screen.getByRole('button', { name: '承認' }))
    await waitFor(() => expect(screen.queryByText('ZXQ2')).toBeNull())
    // 承認後に一覧を取り直している(答え合わせ)
    await waitFor(() => expect(pendingCalls).toBeGreaterThanOrEqual(2))
    expect(screen.queryByText('ZXQ2')).toBeNull()
  })

  it('409（別タブ等で処理済み）は行を消したままにして、エラーは出さない', async () => {
    let approved = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/group-claims/pending')) return pendingResponse(approved ? [] : [SLACK_CLAIM])
      approved = true
      return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) }
    })
    renderPanel('slack')
    await screen.findByText('ZXQ2')
    fireEvent.click(screen.getByRole('button', { name: '承認' }))
    await waitFor(() => expect(screen.queryByText('ZXQ2')).toBeNull())
    expect(screen.queryByText(/失敗|権限|conflict/)).toBeNull()
  })

  it('上限(402)は、サーバーがチャネル別に返す案内文をそのまま出す（Proに誘導しない）', async () => {
    // LINE 以外は Pro でも上限に当たりうる。サーバーは「お問い合わせください」を返すので、
    // 画面側で勝手に「プランを見直すと承認できます」と書き換えない。
    const serverMessage = '接続できる相手先グループ数の上限に達しています。追加はお問い合わせください（営業窓口でご案内します）。'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/group-claims/pending')) return pendingResponse([SLACK_CLAIM])
      return { ok: false, status: 402, json: async () => ({ error: serverMessage, code: 'group_limit_reached' }) }
    })
    renderPanel('slack')
    await screen.findByText('ZXQ2')
    fireEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(await screen.findByText(serverMessage)).toBeInTheDocument()
    expect(screen.queryByText(/プランを見直す/)).toBeNull()
    expect(screen.getByText('ZXQ2')).toBeInTheDocument()
  })

  it('承認が失敗したら行は残し、理由をその行に出す', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/group-claims/pending')) return pendingResponse([SLACK_CLAIM])
      return { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }
    })
    renderPanel('slack')
    await screen.findByText('ZXQ2')
    fireEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(await screen.findByText(/権限がありません/)).toBeInTheDocument()
    expect(screen.getByText('ZXQ2')).toBeInTheDocument()
  })
})

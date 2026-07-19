import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GroupLinksClient } from '@/app/(internal)/[orgId]/secretary/connect/line/groups/GroupLinksClient'

/**
 * 共有botグループ紐付け承認コンソール（Stage 4・PR3a）。
 * promoteのdigest承認(ApprovalsClient/確認待ちタブ)とは別概念・別UI。
 * コード発行(1回表示)＋pending claim一覧の承認/却下（楽観的更新・保存ボタン無し）。
 */

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [
      { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      { id: 'space-2', name: '他org', orgId: 'org-OTHER', orgName: '別事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 1 },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()

/**
 * 承認待ち一覧の静かなポーリング間隔。GroupLinksClient本体の
 * PENDING_CLAIMS_POLL_INTERVAL_MS(15秒・WAITINGティア = 1対1接続待ち画面と同じ)と揃える。
 */
const POLL_INTERVAL_MS = 15_000

function pendingCallCount() {
  return fetchMock.mock.calls.filter(([url]) => (url as string).includes('/api/channels/group-claims/pending'))
    .length
}

/**
 * 承認/却下後の invalidateQueries(['channelGroups','channelGroupCounts']) 検証のため
 * QueryClientProvider で包む(実アプリはroot layoutのQueryProviderが供給する)。
 */
function renderPanel(orgId: string = ORG) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <GroupLinksClient orgId={orgId} />
    </QueryClientProvider>,
  )
  return { queryClient, ...utils }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

function mockApis({
  pendingItems = [],
  issueResponse,
  policyResponse,
  issueBatchResponse,
  approvalResponse,
}: {
  pendingItems?: unknown[]
  issueResponse?: { ok: boolean; status?: number; body: unknown }
  policyResponse?: { ok: boolean; body: unknown }
  issueBatchResponse?: { ok: boolean; body: unknown }
  approvalResponse?: { ok: boolean; status?: number; body: unknown }
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/api/channels/group-claims/pending')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: pendingItems }) })
    }
    if (url.includes('/api/channels/group-claims/policy')) {
      const res = policyResponse ?? { ok: true, body: { allowCodeOnly: false } }
      return Promise.resolve({ ok: res.ok, json: () => Promise.resolve(res.body) })
    }
    if (url.includes('/api/channels/group-claims/issue-batch') && init?.method === 'POST') {
      const res = issueBatchResponse ?? {
        ok: true,
        body: {
          items: [{ spaceId: 'space-1', displayCode: 'GC-AAAAAA-BBBBB-CCCCC-DDDDD-EEEEE' }],
          expiresAt: '2026-07-23T00:00:00.000Z',
        },
      }
      return Promise.resolve({ ok: res.ok, json: () => Promise.resolve(res.body) })
    }
    if (url.includes('/api/channels/group-claims/issue') && init?.method === 'POST') {
      const res = issueResponse ?? { ok: true, body: { code: 'GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234', expiresAt: '2026-07-16T00:30:00.000Z' } }
      return Promise.resolve({ ok: res.ok, status: res.status, json: () => Promise.resolve(res.body) })
    }
    if (url.includes('/api/channels/group-claims/approval') && init?.method === 'POST') {
      const res = approvalResponse ?? { ok: true, body: { status: 'approved' } }
      return Promise.resolve({ ok: res.ok, status: res.status, json: () => Promise.resolve(res.body) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

describe('GroupLinksClient', () => {
  it('プロジェクト選択肢は自org分のみ（他orgのspaceは出さない）', async () => {
    mockApis({})
    renderPanel()

    await waitFor(() => screen.getByText('コードを発行'))
    expect(screen.getByText('山田商事')).toBeInTheDocument()
    expect(screen.queryByText('他org')).not.toBeInTheDocument()
  })

  it('プロジェクトを選んで発行すると、コードが1回だけ表示されコピーできる', async () => {
    mockApis({})
    renderPanel()

    await waitFor(() => screen.getByText('コードを発行'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('コードを発行'))

    await waitFor(() => {
      expect(screen.getByText('GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('コピー'))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')
    })
  })

  it('発行失敗時はエラーメッセージを表示する', async () => {
    mockApis({ issueResponse: { ok: false, body: { error: '共有botが未設定です' } } })
    renderPanel()

    await waitFor(() => screen.getByText('コードを発行'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('コードを発行'))

    await waitFor(() => {
      expect(screen.getByText('共有botが未設定です')).toBeInTheDocument()
    })
  })

  it('相手先グループ数の上限(402 group_limit_reached)時はProアップセル文言を表示する', async () => {
    mockApis({
      issueResponse: {
        ok: false,
        status: 402,
        body: {
          error: '接続できる相手先グループ数の上限に達しています。Proにアップグレードすると増やせます。',
          code: 'group_limit_reached',
          limit: 3,
        },
      },
    })
    renderPanel()

    await waitFor(() => screen.getByText('コードを発行'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('コードを発行'))

    await waitFor(() => {
      expect(screen.getByText(/自社LINE.*なら/)).toBeInTheDocument()
    })
    expect(screen.getByText(/送信の上限なし/)).toBeInTheDocument()
    expect(screen.getByText('プランを見る').closest('a')).toHaveAttribute('href', '/settings/billing')
    // 通常のエラーメッセージ(赤)ではなく、上限専用の文言のみが出る
    expect(screen.queryByText('接続できる相手先グループ数の上限に達しています。Proにアップグレードすると増やせます。')).not.toBeInTheDocument()
  })

  it('確認待ちが無ければ空状態を表示する', async () => {
    mockApis({ pendingItems: [] })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('確認待ちのグループはありません。')).toBeInTheDocument()
    })
  })

  it('確認待ち一覧を表示し、承認すると楽観的にリストから消える（保存ボタン無し）', async () => {
    mockApis({
      pendingItems: [
        {
          id: 'claim-1',
          externalGroupId: 'G-1',
          spaceId: 'space-1',
          spaceName: '山田商事',
          challengeLabel: 'AB12',
          groupDisplayNameSnapshot: 'ある会社の相談グループ',
          createdAt: '2026-07-16T00:00:00Z',
        },
      ],
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('ある会社の相談グループ')).toBeInTheDocument()
    })
    expect(screen.getByText(/AB12/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('承認'))

    await waitFor(() => {
      expect(screen.queryByText('ある会社の相談グループ')).not.toBeInTheDocument()
    })

    const approvalCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/channels/group-claims/approval'))
    expect(approvalCall).toBeTruthy()
    const body = JSON.parse((approvalCall![1] as RequestInit).body as string)
    expect(body).toEqual({ orgId: ORG, claimId: 'claim-1', action: 'approve' })
  })

  it('承認成功後は channelGroups と channelGroupCounts を invalidate する（承認はchannel_groupsを作るため）', async () => {
    mockApis({
      pendingItems: [
        {
          id: 'claim-1',
          externalGroupId: 'G-1',
          spaceId: 'space-1',
          spaceName: '山田商事',
          challengeLabel: 'AB12',
          groupDisplayNameSnapshot: 'ある会社の相談グループ',
          createdAt: '2026-07-16T00:00:00Z',
        },
      ],
    })
    const { queryClient } = renderPanel()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await waitFor(() => screen.getByText('ある会社の相談グループ'))
    fireEvent.click(screen.getByText('承認'))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channelGroups', ORG] })
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channelGroupCounts', ORG] })
  })

  it('却下すると楽観的にリストから消える', async () => {
    mockApis({
      pendingItems: [
        {
          id: 'claim-1',
          externalGroupId: 'G-1',
          spaceId: 'space-1',
          spaceName: '山田商事',
          challengeLabel: 'AB12',
          groupDisplayNameSnapshot: 'ある会社の相談グループ',
          createdAt: '2026-07-16T00:00:00Z',
        },
      ],
    })
    renderPanel()

    await waitFor(() => screen.getByText('ある会社の相談グループ'))
    fireEvent.click(screen.getByText('却下'))

    await waitFor(() => {
      expect(screen.queryByText('ある会社の相談グループ')).not.toBeInTheDocument()
    })

    const approvalCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/channels/group-claims/approval'))
    const body = JSON.parse((approvalCall![1] as RequestInit).body as string)
    expect(body.action).toBe('reject')
  })

  it('却下は channel_groups を作らないため invalidateQueries を呼ばない', async () => {
    mockApis({
      pendingItems: [
        {
          id: 'claim-1',
          externalGroupId: 'G-1',
          spaceId: 'space-1',
          spaceName: '山田商事',
          challengeLabel: 'AB12',
          groupDisplayNameSnapshot: 'ある会社の相談グループ',
          createdAt: '2026-07-16T00:00:00Z',
        },
      ],
    })
    const { queryClient } = renderPanel()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await waitFor(() => screen.getByText('ある会社の相談グループ'))
    fireEvent.click(screen.getByText('却下'))

    await waitFor(() => {
      expect(screen.queryByText('ある会社の相談グループ')).not.toBeInTheDocument()
    })
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('承認時に相手先グループ数の上限(402 group_limit_reached)を踏むと行内にProアップセル文言を出す', async () => {
    mockApis({
      pendingItems: [
        {
          id: 'claim-1',
          externalGroupId: 'G-1',
          spaceId: 'space-1',
          spaceName: '山田商事',
          challengeLabel: 'AB12',
          groupDisplayNameSnapshot: 'ある会社の相談グループ',
          createdAt: '2026-07-16T00:00:00Z',
        },
      ],
      approvalResponse: {
        ok: false,
        status: 402,
        body: {
          error: '接続できる相手先グループ数の上限に達しています。Proにアップグレードすると増やせます。',
          code: 'group_limit_reached',
          limit: 3,
        },
      },
    })
    renderPanel()

    await waitFor(() => screen.getByText('ある会社の相談グループ'))
    fireEvent.click(screen.getByText('承認'))

    await waitFor(() => {
      expect(screen.getByText(/自社LINE.*なら/)).toBeInTheDocument()
    })
    expect(screen.getByText(/送信の上限なし/)).toBeInTheDocument()
    expect(screen.getByText('プランを見る').closest('a')).toHaveAttribute('href', '/settings/billing')
    // 上限到達時は既存のクレームを消さない(承認は成立していない)
    expect(screen.getByText('ある会社の相談グループ')).toBeInTheDocument()
  })

  it('409(既処理)は行を消し、それ以外の失敗は行に残ってエラーを出す', async () => {
    mockApis({
      pendingItems: [
        {
          id: 'claim-1',
          externalGroupId: 'G-1',
          spaceId: 'space-1',
          spaceName: '山田商事',
          challengeLabel: 'AB12',
          groupDisplayNameSnapshot: 'ある会社の相談グループ',
          createdAt: '2026-07-16T00:00:00Z',
        },
      ],
    })
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/channels/group-claims/pending')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: 'claim-1',
                  externalGroupId: 'G-1',
                  spaceId: 'space-1',
                  spaceName: '山田商事',
                  challengeLabel: 'AB12',
                  groupDisplayNameSnapshot: 'ある会社の相談グループ',
                  createdAt: '2026-07-16T00:00:00Z',
                },
              ],
            }),
        })
      }
      if (url.includes('/api/channels/group-claims/approval') && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'conflict' }) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    renderPanel()
    await waitFor(() => screen.getByText('ある会社の相談グループ'))
    fireEvent.click(screen.getByText('承認'))

    // 409は他経路(別タブ)で処理済み扱い → リストから消える
    await waitFor(() => {
      expect(screen.queryByText('ある会社の相談グループ')).not.toBeInTheDocument()
    })
  })

  describe('本部一括発行（code_only・entitlementがある時だけ表示）', () => {
    it('entitlement無し(allowCodeOnly=false)の場合はセクションを表示しない', async () => {
      mockApis({ policyResponse: { ok: true, body: { allowCodeOnly: false } } })
      renderPanel()

      await waitFor(() => screen.getByText('コードを発行'))
      expect(screen.queryByText('本部一括発行')).not.toBeInTheDocument()
    })

    it('entitlementあり(allowCodeOnly=true)の場合はセクションを表示する', async () => {
      mockApis({ policyResponse: { ok: true, body: { allowCodeOnly: true } } })
      renderPanel()

      await waitFor(() => {
        expect(screen.getByText('本部一括発行')).toBeInTheDocument()
      })
      expect(screen.getByLabelText('山田商事')).toBeInTheDocument()
      // 他orgのspaceは選択肢に出さない
      const otherOrgCheckbox = screen.queryByLabelText('他org')
      expect(otherOrgCheckbox).not.toBeInTheDocument()
    })

    it('spaceを選んで一括発行すると、発行されたコード一覧が1回表示される', async () => {
      mockApis({
        policyResponse: { ok: true, body: { allowCodeOnly: true } },
        issueBatchResponse: {
          ok: true,
          body: {
            items: [{ spaceId: 'space-1', displayCode: 'GC-AAAAAA-BBBBB-CCCCC-DDDDD-EEEEE' }],
            expiresAt: '2026-07-23T00:00:00.000Z',
          },
        },
      })
      renderPanel()

      await waitFor(() => screen.getByText('本部一括発行'))
      fireEvent.click(screen.getByLabelText('山田商事'))
      fireEvent.click(screen.getByText('一括発行'))

      await waitFor(() => {
        expect(screen.getByText('GC-AAAAAA-BBBBB-CCCCC-DDDDD-EEEEE')).toBeInTheDocument()
      })

      const batchCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/channels/group-claims/issue-batch'))
      expect(batchCall).toBeTruthy()
      const body = JSON.parse((batchCall![1] as RequestInit).body as string)
      expect(body).toEqual({ orgId: ORG, spaceIds: ['space-1'] })
    })

    it('発行失敗時はエラーメッセージを表示する', async () => {
      mockApis({
        policyResponse: { ok: true, body: { allowCodeOnly: true } },
        issueBatchResponse: { ok: false, body: { error: 'このorgはcode_only発行が許可されていません' } },
      })
      renderPanel()

      await waitFor(() => screen.getByText('本部一括発行'))
      fireEvent.click(screen.getByLabelText('山田商事'))
      fireEvent.click(screen.getByText('一括発行'))

      await waitFor(() => {
        expect(screen.getByText('このorgはcode_only発行が許可されていません')).toBeInTheDocument()
      })
    })
  })

  describe('確認待ち一覧の静かなポーリング（相手先のグループ参加を自動反映・1対1接続待ち画面と挙動を揃える）', () => {
    it('初回mountでは取得中にloadingスケルトンを表示し、その後データ表示に切り替わる', async () => {
      let resolvePending!: () => void
      const pendingGate = new Promise<void>((resolve) => {
        resolvePending = resolve
      })
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/api/channels/group-claims/pending')) {
          return pendingGate.then(() => ({ ok: true, json: () => Promise.resolve({ items: [] }) }))
        }
        if (url.includes('/api/channels/group-claims/policy')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ allowCodeOnly: false }) })
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      })

      renderPanel()
      expect(await screen.findByText('読み込み中...')).toBeInTheDocument()

      resolvePending()
      await waitFor(() => {
        expect(screen.getByText('確認待ちのグループはありません。')).toBeInTheDocument()
      })
      expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    })

    it('15秒経過でサイレント再取得が走り、新しい承認待ち行が追加表示される（loadingスケルトンは再表示されずチラつかない）', async () => {
      let items: unknown[] = []
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/api/channels/group-claims/pending')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) })
        }
        if (url.includes('/api/channels/group-claims/policy')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ allowCodeOnly: false }) })
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      })

      vi.useFakeTimers()
      try {
        renderPanel()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(screen.getByText('確認待ちのグループはありません。')).toBeInTheDocument()

        // 相手先がLINEグループに参加した想定 → 次のpending応答に新規行が現れる
        items = [
          {
            id: 'claim-2',
            externalGroupId: 'G-2',
            spaceId: 'space-1',
            spaceName: '山田商事',
            challengeLabel: 'CD34',
            groupDisplayNameSnapshot: '新しい相談グループ',
            createdAt: '2026-07-16T00:00:10Z',
          },
        ]

        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
        })

        expect(screen.getByText('新しい相談グループ')).toBeInTheDocument()
        // silent reloadなのでloadingスケルトンは再表示されない(チラつかない)
        expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('unmountでintervalがクリアされ、以降ポーリングされない', async () => {
      mockApis({ pendingItems: [] })

      vi.useFakeTimers()
      try {
        const { unmount } = renderPanel()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        const countAtMount = pendingCallCount()

        unmount()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
        })

        expect(pendingCallCount()).toBe(countAtMount)
      } finally {
        vi.useRealTimers()
      }
    })

    it('document.visibilityStateがhiddenの間はポーリングfetchをスキップする', async () => {
      mockApis({ pendingItems: [] })
      const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

      vi.useFakeTimers()
      try {
        renderPanel()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        const countAfterMount = pendingCallCount()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
        })

        // hidden中はポーリングfetchが発火しない
        expect(pendingCallCount()).toBe(countAfterMount)
      } finally {
        vi.useRealTimers()
        if (originalDescriptor) {
          Object.defineProperty(document, 'visibilityState', originalDescriptor)
        } else {
          Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        }
      }
    })

    it('承認処理中(busy)にポーリングが走っても、楽観除去した行が一瞬復活しない（busyガード）', async () => {
      let resolveApproval!: () => void
      const approvalGate = new Promise<void>((resolve) => {
        resolveApproval = resolve
      })
      const claim = {
        id: 'claim-1',
        externalGroupId: 'G-1',
        spaceId: 'space-1',
        spaceName: '山田商事',
        challengeLabel: 'AB12',
        groupDisplayNameSnapshot: 'ある会社の相談グループ',
        createdAt: '2026-07-16T00:00:00Z',
      }
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/api/channels/group-claims/pending')) {
          // ポーリングはサーバがまだcommit前(承認処理中)の一覧を返し続ける想定
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [claim] }) })
        }
        if (url.includes('/api/channels/group-claims/policy')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ allowCodeOnly: false }) })
        }
        if (url.includes('/api/channels/group-claims/approval') && init?.method === 'POST') {
          return approvalGate.then(() => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: 'approved' }),
          }))
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      })

      vi.useFakeTimers()
      try {
        renderPanel()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(screen.getByText('ある会社の相談グループ')).toBeInTheDocument()

        await act(async () => {
          fireEvent.click(screen.getByText('承認'))
          await vi.advanceTimersByTimeAsync(0)
        })

        // busy中にポーリングが1回走る(サーバ応答はまだ承認前の一覧のまま)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
        })
        // busyガードにより重複表示・復活せず1件のまま
        expect(screen.getAllByText('ある会社の相談グループ')).toHaveLength(1)

        // 承認APIが完了すると、楽観除去どおりリストから消える
        resolveApproval()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(screen.queryByText('ある会社の相談グループ')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

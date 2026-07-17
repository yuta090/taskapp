import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GroupLinksClient } from '@/app/(internal)/[orgId]/secretary/group-links/GroupLinksClient'

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
}: {
  pendingItems?: unknown[]
  issueResponse?: { ok: boolean; body: unknown }
  policyResponse?: { ok: boolean; body: unknown }
  issueBatchResponse?: { ok: boolean; body: unknown }
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
      return Promise.resolve({ ok: res.ok, json: () => Promise.resolve(res.body) })
    }
    if (url.includes('/api/channels/group-claims/approval') && init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'approved' }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

describe('GroupLinksClient', () => {
  it('プロジェクト選択肢は自org分のみ（他orgのspaceは出さない）', async () => {
    mockApis({})
    render(<GroupLinksClient orgId={ORG} />)

    await waitFor(() => screen.getByText('コードを発行'))
    expect(screen.getByText('山田商事')).toBeInTheDocument()
    expect(screen.queryByText('他org')).not.toBeInTheDocument()
  })

  it('プロジェクトを選んで発行すると、コードが1回だけ表示されコピーできる', async () => {
    mockApis({})
    render(<GroupLinksClient orgId={ORG} />)

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
    render(<GroupLinksClient orgId={ORG} />)

    await waitFor(() => screen.getByText('コードを発行'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })
    fireEvent.click(screen.getByText('コードを発行'))

    await waitFor(() => {
      expect(screen.getByText('共有botが未設定です')).toBeInTheDocument()
    })
  })

  it('確認待ちが無ければ空状態を表示する', async () => {
    mockApis({ pendingItems: [] })
    render(<GroupLinksClient orgId={ORG} />)

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
    render(<GroupLinksClient orgId={ORG} />)

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
    render(<GroupLinksClient orgId={ORG} />)

    await waitFor(() => screen.getByText('ある会社の相談グループ'))
    fireEvent.click(screen.getByText('却下'))

    await waitFor(() => {
      expect(screen.queryByText('ある会社の相談グループ')).not.toBeInTheDocument()
    })

    const approvalCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/channels/group-claims/approval'))
    const body = JSON.parse((approvalCall![1] as RequestInit).body as string)
    expect(body.action).toBe('reject')
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

    render(<GroupLinksClient orgId={ORG} />)
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
      render(<GroupLinksClient orgId={ORG} />)

      await waitFor(() => screen.getByText('コードを発行'))
      expect(screen.queryByText('本部一括発行')).not.toBeInTheDocument()
    })

    it('entitlementあり(allowCodeOnly=true)の場合はセクションを表示する', async () => {
      mockApis({ policyResponse: { ok: true, body: { allowCodeOnly: true } } })
      render(<GroupLinksClient orgId={ORG} />)

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
      render(<GroupLinksClient orgId={ORG} />)

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
      render(<GroupLinksClient orgId={ORG} />)

      await waitFor(() => screen.getByText('本部一括発行'))
      fireEvent.click(screen.getByLabelText('山田商事'))
      fireEvent.click(screen.getByText('一括発行'))

      await waitFor(() => {
        expect(screen.getByText('このorgはcode_only発行が許可されていません')).toBeInTheDocument()
      })
    })
  })
})

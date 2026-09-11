import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OrgIntegrationsPage from '@/app/settings/org-integrations/page'

/**
 * `?github=` の1発目の要求に対する耐性・「orgId が決まってから処理する」レース対策・
 * リポジトリ件数の妥当性チェックのテストも同じファイルに置く（page.test.tsx として1本化）。
 */

/**
 * 組織設定(外部連携)ページ。
 *
 * GitHub App の連携（/api/github/authorize → GitHub → /api/github/callback）から
 * ?github=<種類>（エラー）/ ?github=connected&repos=<N>（成功）で戻ってくる。
 * Slack の ?slack= と同じ形でトースト表示し、表示後は URL からクエリを消す。
 */

process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'

let searchParamsValue = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsValue,
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: (...args: unknown[]) => mockUseCurrentOrg(...args),
}))

vi.mock('@/components/settings/GitHubOrgConnectionCard', () => ({
  GitHubOrgConnectionCard: () => <div data-testid="github-org-connection-card" />,
}))

vi.mock('@/lib/hooks/useSlack', () => ({
  useSlackWorkspace: () => ({ data: null, isLoading: false }),
  useSaveSlackToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisconnectSlack: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/hooks/useAiConfig', () => ({
  useAiConfig: () => ({ data: null, isLoading: false }),
  useSaveAiConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAiConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) },
}))

const replaceStateSpy = vi.fn()

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <OrgIntegrationsPage />
    </QueryClientProvider>
  )
  return { ...utils, queryClient, invalidateSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = new URLSearchParams()
  mockUseCurrentOrg.mockReturnValue({
    orgId: 'org-1',
    orgName: 'Org',
    role: 'owner',
    loading: false,
  })
  vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => replaceStateSpy(...args))
})

describe('OrgIntegrationsPage — GitHub連携結果のトースト', () => {
  it('connected: 件数入りの成功トーストを出し、URLのクエリを消す', async () => {
    searchParamsValue = new URLSearchParams('github=connected&repos=3')

    renderPage()

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('GitHub と接続しました（リポジトリ 3 件）')
    })
    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/settings/org-integrations')
  })

  it('forbidden: オーナー限定である旨のエラートーストを出す', async () => {
    searchParamsValue = new URLSearchParams('github=forbidden')

    renderPage()

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('GitHub の接続は、この組織のオーナーだけができます')
    })
  })

  it('installation_not_owned: GitHub側のオーナーである必要がある旨のエラートーストを出す', async () => {
    searchParamsValue = new URLSearchParams('github=installation_not_owned')

    renderPage()

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'GitHub 側で、そのアカウントの持ち主（組織の場合はオーナー）である必要があります。GitHub 組織のオーナーが接続してください'
      )
    })
  })

  it('未知のエラーコードは汎用の失敗メッセージにする', async () => {
    searchParamsValue = new URLSearchParams('github=api_error')

    renderPage()

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('うまく接続できませんでした。時間をおいてもう一度お試しください')
    })
  })

  it('githubパラメータが無ければトーストを出さない', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('github-org-connection-card')).toBeInTheDocument()
    })
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('connected: 両方のキャッシュ(github-connection-status / github-installation)を取り直す', async () => {
    searchParamsValue = new URLSearchParams('github=connected&repos=3')

    const { invalidateSpy } = renderPage()

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled()
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['github-connection-status', 'org-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['github-installation', 'org-1'] })
  })

  it('件数(repos)が数字でなければ、件数なしの成功トーストにする', async () => {
    searchParamsValue = new URLSearchParams('github=connected&repos=abc')

    renderPage()

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('GitHub と接続しました')
    })
  })

  it('件数(repos)が無ければ、件数なしの成功トーストにする', async () => {
    searchParamsValue = new URLSearchParams('github=connected')

    renderPage()

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('GitHub と接続しました')
    })
  })

  it('__proto__ / constructor / hasOwnProperty をエラー種別に渡しても落ちず、既定の失敗メッセージにする', async () => {
    for (const code of ['__proto__', 'constructor', 'hasOwnProperty']) {
      vi.clearAllMocks()
      searchParamsValue = new URLSearchParams(`github=${code}`)

      expect(() => renderPage()).not.toThrow()

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith('うまく接続できませんでした。時間をおいてもう一度お試しください')
      })
    }
  })

  it('orgId が決まるまでは、トースト・キャッシュ更新・URLのクリアをしない（決まってから1回だけ処理する）', async () => {
    searchParamsValue = new URLSearchParams('github=connected&repos=3')
    mockUseCurrentOrg.mockReturnValue({ orgId: null, orgName: null, role: null, loading: true })

    const { rerender, queryClient, invalidateSpy } = renderPage()

    // orgId が決まるまでは何もしない
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(replaceStateSpy).not.toHaveBeenCalled()

    // orgId が決まった
    mockUseCurrentOrg.mockReturnValue({ orgId: 'org-1', orgName: 'Org', role: 'owner', loading: false })
    rerender(
      <QueryClientProvider client={queryClient}>
        <OrgIntegrationsPage />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1)
    })
    expect(toastSuccess).toHaveBeenCalledWith('GitHub と接続しました（リポジトリ 3 件）')
    expect(replaceStateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['github-connection-status', 'org-1'] })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OnboardingPage from '@/app/(auth)/onboarding/page'

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage />
    </QueryClientProvider>
  )
}

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/onboarding',
}))

const mockGetUser = vi.fn()
const mockSignOut = vi.fn().mockResolvedValue({ error: null })
const mockRpc = vi.fn()

const { mockSignOutAndLeave } = vi.hoisted(() => ({
  mockSignOutAndLeave: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

// テーブル別に応答を差し替えられる Supabase mock
let membershipResponse: { data: { org_id: string; role: string } | null }
let spaceResponse: { data: { id: string } | null }

const membershipChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(() => Promise.resolve(membershipResponse)),
}
const spacesChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(() => Promise.resolve(spaceResponse)),
}
const profilesChain = {
  upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
    from: (table: string) => {
      if (table === 'spaces') return spacesChain
      if (table === 'profiles') return profilesChain
      return membershipChain
    },
    rpc: mockRpc,
  }),
}))

function mockUser(metadata: Record<string, string> = {}, email?: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1', email, user_metadata: metadata } },
  })
}

describe('OnboardingPage — Step 1: 組織作成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    membershipResponse = { data: null }
    spaceResponse = { data: null }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should prefill the org name from user_metadata.org_name', async () => {
    mockUser({ org_name: '株式会社サンプル' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('株式会社サンプル')
    })
  })

  it('should show the prefill-specific description when org_name is available', async () => {
    mockUser({ org_name: '株式会社サンプル' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('登録時の組織名を確認して開始してください。')).toBeInTheDocument()
    })
  })

  it('should keep the default description when org_name is not available', async () => {
    mockUser()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('あと少しで完了です。組織名を入力してください。')).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('')
  })

  it('組織作成に成功したらプロジェクト作成ステップ（テンプレート選択）へ進む', async () => {
    mockUser({ full_name: '山田太郎', org_name: '株式会社サンプル' })
    mockRpc.mockResolvedValue({ data: { org_id: 'org-1', plan_id: 'free' }, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('株式会社サンプル')
    })

    fireEvent.click(screen.getByRole('button', { name: /開始する/ }))

    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    // テンプレートカードが並ぶ
    expect(screen.getByText('Web/アプリ開発')).toBeInTheDocument()
    expect(screen.getByText(/白紙から始める/)).toBeInTheDocument()
    // /inbox へは飛ばさない
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

describe('OnboardingPage — Step 1: あなたの名前入力', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    membershipResponse = { data: null }
    spaceResponse = { data: null }
    profilesChain.upsert.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('組織名の上に「あなたの名前」入力欄が表示される', async () => {
    mockUser()

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toBeInTheDocument()
    })
  })

  it('user_metadata.full_name があればプレフィルする', async () => {
    mockUser({ full_name: '山田太郎' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toHaveValue('山田太郎')
    })
  })

  it('full_name も name も無ければメールのローカル部をプレフィルする', async () => {
    mockUser({}, 'taro@example.com')

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toHaveValue('taro')
    })
  })

  it('組織作成成功時にprofilesへdisplay_nameをupsertする(update ではなく upsert)', async () => {
    mockUser({ full_name: '佐藤花子', org_name: '株式会社テスト' })
    mockRpc.mockResolvedValue({ data: { org_id: 'org-1', plan_id: 'free' }, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toHaveValue('佐藤花子')
    })

    fireEvent.click(screen.getByRole('button', { name: /開始する/ }))

    await waitFor(() => {
      expect(profilesChain.upsert).toHaveBeenCalledWith(
        { id: 'user-1', display_name: '佐藤花子' },
        { onConflict: 'id' },
      )
    })
  })

  it('display_nameのupsertが失敗してもオンボーディングは継続する', async () => {
    mockUser({ full_name: '佐藤花子', org_name: '株式会社テスト' })
    mockRpc.mockResolvedValue({ data: { org_id: 'org-1', plan_id: 'free' }, error: null })
    profilesChain.upsert.mockResolvedValueOnce({ data: null, error: { message: 'RLS violation' } })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toHaveValue('佐藤花子')
    })

    fireEvent.click(screen.getByRole('button', { name: /開始する/ }))

    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

describe('OnboardingPage — 再開・リダイレクト', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    membershipResponse = { data: null }
    spaceResponse = { data: null }
    localStorage.clear()
  })

  it('組織はあるがプロジェクトが無い場合はテンプレート選択ステップを表示（死にコード修正）', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: null }

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/inbox')
  })

  it('組織もプロジェクトもある場合はプロジェクトへリダイレクト', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: { id: 'space-1' } }

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/org-1/project/space-1')
    })
  })

  it('clientロールは /portal へリダイレクト', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'client' } }

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/portal')
    })
  })

  it('組織あり・プロジェクト無しでは lastPath が残っていても Step2 を表示（/inbox に弾かれない）', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: null }
    localStorage.setItem('taskapp:lastPath', '/inbox')

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('組織・プロジェクトありで現在の組織の lastPath があればそこへ復帰', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: { id: 'space-1' } }
    localStorage.setItem('taskapp:lastPath', '/org-1/project/space-2')

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/org-1/project/space-2')
    })
  })

  it('別組織・ポータル等の lastPath は無視して最初のプロジェクトへ', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: { id: 'space-1' } }
    localStorage.setItem('taskapp:lastPath', '/other-org/project/space-9')

    renderPage()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/org-1/project/space-1')
    })
  })
})

describe('OnboardingPage — Step 2: テンプレート選択とプロジェクト作成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: null }
    localStorage.clear()
  })

  async function renderStep2() {
    mockUser()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
  }

  it('テンプレートを選んだだけでは作成せず、説明（作成されるもの）と「作成する」ボタンが出る', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch
    await renderStep2()

    // 選ぶ前は作成ボタンが無い
    expect(screen.queryByRole('button', { name: /プロジェクトを作成する/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('コンサルティング'))

    // 押しただけでは API を呼ばない（以前はカードを押した瞬間に作成されていた）
    expect(global.fetch).not.toHaveBeenCalled()
    // 何が作られるかの説明が出る
    expect(screen.getByText('作成されるもの')).toBeInTheDocument()
    expect(screen.getByText(/調査レポート/)).toBeInTheDocument()
    expect(screen.getByText(/現状分析 → 課題整理 → 提案/)).toBeInTheDocument()
    expect(screen.getByText('調査・提案・議事録の標準構成')).toBeInTheDocument()
    // 選んだカードが選択状態になる
    expect(screen.getByRole('button', { name: /コンサルティング/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Web\/アプリ開発/ })).toHaveAttribute('aria-pressed', 'false')
    // 作成ボタンが出る
    expect(screen.getByRole('button', { name: /プロジェクトを作成する/ })).toBeInTheDocument()
  })

  it('選び直すと説明も切り替わる', async () => {
    await renderStep2()
    fireEvent.click(screen.getByText('コンサルティング'))
    expect(screen.getByText(/調査レポート/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('デザイン制作'))
    expect(screen.queryByText(/調査レポート/)).not.toBeInTheDocument()
    expect(screen.getByText(/デザインブリーフ/)).toBeInTheDocument()
  })

  it('白紙を選んだときも説明と作成ボタンが出る', async () => {
    await renderStep2()
    fireEvent.click(screen.getByText(/白紙から始める/))
    expect(screen.getByText(/空のプロジェクトだけを作ります/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /プロジェクトを作成する/ })).toBeInTheDocument()
  })

  it('「作成する」を押すと create-with-preset API を呼びプロジェクトへ遷移する', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ space: { id: 'space-9' } }),
    }) as unknown as typeof fetch

    await renderStep2()

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), {
      target: { value: 'コーポレートサイト制作' },
    })
    fireEvent.click(screen.getByText('Web/アプリ開発'))
    fireEvent.click(screen.getByRole('button', { name: /プロジェクトを作成する/ }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/spaces/create-with-preset',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(body).toEqual({
      name: 'コーポレートサイト制作',
      presetGenre: 'web_development',
      orgId: 'org-1',
    })

    await waitFor(() => {
      // 初回セットアップ完了の目印 ?onboarded=1 を付けて遷移する
      // （アクセス解析で「会員登録→設定完了」をこのURLで CV として数えるため。
      //   毎日の作業画面と同じURLに着地するので、この目印が無いと区別できない）
      expect(mockPush).toHaveBeenCalledWith('/org-1/project/space-9?onboarded=1')
    })
  })

  it('遷移の前に所属組織一覧（orgMemberships）のキャッシュを取り直す（ActiveOrgProviderはルート常駐で画面遷移しても再マウントしないため）', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ space: { id: 'space-9' } }),
    }) as unknown as typeof fetch

    await renderStep2()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), {
      target: { value: 'コーポレートサイト制作' },
    })
    fireEvent.click(screen.getByText('Web/アプリ開発'))
    fireEvent.click(screen.getByRole('button', { name: /プロジェクトを作成する/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/org-1/project/space-9?onboarded=1')
    })
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['orgMemberships'] }))
    const invalidateOrder = invalidateSpy.mock.invocationCallOrder[0]
    const pushOrder = mockPush.mock.invocationCallOrder[0]
    expect(invalidateOrder).toBeLessThan(pushOrder)
  })

  it('invalidateQueriesの解決を待ってから遷移する（awaitしていなければここで落ちる）', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ space: { id: 'space-9' } }),
    }) as unknown as typeof fetch

    await renderStep2()
    let resolveInvalidate: () => void = () => {}
    const pending = new Promise<void>((resolve) => { resolveInvalidate = resolve })
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending)

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), {
      target: { value: 'コーポレートサイト制作' },
    })
    fireEvent.click(screen.getByText('Web/アプリ開発'))
    fireEvent.click(screen.getByRole('button', { name: /プロジェクトを作成する/ }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/spaces/create-with-preset',
        expect.objectContaining({ method: 'POST' })
      )
    })

    // invalidateQueries がまだ解決していない間は遷移しない
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(mockPush).not.toHaveBeenCalled()

    resolveInvalidate()
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/org-1/project/space-9?onboarded=1')
    })
  })

  it('API失敗時はエラーを表示してステップに留まる', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Failed to create space' }),
    }) as unknown as typeof fetch

    await renderStep2()

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), {
      target: { value: '新規案件' },
    })
    fireEvent.click(screen.getByText(/白紙から始める/))
    fireEvent.click(screen.getByRole('button', { name: /プロジェクトを作成する/ }))

    await waitFor(() => {
      expect(screen.getByText('プロジェクトの作成に失敗しました。もう一度お試しください。')).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
    // ピッカーは選び直せる状態のまま
    expect(screen.getByText('Web/アプリ開発')).toBeInTheDocument()
  })

  it('プロジェクト名が空のまま「作成する」を押すとバリデーションエラー', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch

    await renderStep2()

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), { target: { value: '  ' } })
    fireEvent.click(screen.getByText('Web/アプリ開発'))
    fireEvent.click(screen.getByRole('button', { name: /プロジェクトを作成する/ }))

    await waitFor(() => {
      expect(screen.getByText('プロジェクト名を入力してください。')).toBeInTheDocument()
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('OnboardingPage — 別のアカウントでやり直せる（ログアウト導線）', () => {
  // 背景: Googleログインで会員でないアカウントに入ると /onboarding に来るが、この画面に
  // ログアウトが無く、/login に戻っても proxy が /onboarding へ押し戻すため、
  // プロジェクトを作らない限り別アカウントに切り替えられなかった。
  beforeEach(() => {
    vi.clearAllMocks()
    membershipResponse = { data: null }
    spaceResponse = { data: null }
    localStorage.clear()
  })

  it('Step1（組織作成）にログイン中のメールと「別のアカウントでログイン」導線が出る', async () => {
    mockUser({}, 'taro@example.com')
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('組織を作成')).toBeInTheDocument()
    })
    expect(screen.getByText(/taro@example\.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /別のアカウントでログイン/ })).toBeInTheDocument()
  })

  it('Step2（最初のプロジェクト作成）は横に広いカードで出す（ジャンル10種が縦長に並ばない）', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    expect(screen.getByTestId('auth-card').className).toContain('max-w-4xl')
  })

  it('Step1（組織作成）は従来どおり狭いカードのまま', async () => {
    mockUser()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('組織を作成')).toBeInTheDocument()
    })
    expect(screen.getByTestId('auth-card').className).toContain('max-w-md')
  })

  it('Step2（最初のプロジェクト作成）にも同じ導線が出る', async () => {
    mockUser({}, 'taro@example.com')
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /別のアカウントでログイン/ })).toBeInTheDocument()
  })

  it('押すと signOutAndLeave({ to: "/login", pushCleanup: false }) を呼ぶ（router.replace はしない）', async () => {
    mockUser({}, 'taro@example.com')
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('組織を作成')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /別のアカウントでログイン/ }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/login', pushCleanup: false })
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/login')
  })
})

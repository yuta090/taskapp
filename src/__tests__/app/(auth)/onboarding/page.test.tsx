import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import OnboardingPage from '@/app/(auth)/onboarding/page'

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/onboarding',
}))

const mockGetUser = vi.fn()
const mockRpc = vi.fn()

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
    auth: { getUser: mockGetUser },
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

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('株式会社サンプル')
    })
  })

  it('should show the prefill-specific description when org_name is available', async () => {
    mockUser({ org_name: '株式会社サンプル' })

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByText('登録時の組織名を確認して開始してください。')).toBeInTheDocument()
    })
  })

  it('should keep the default description when org_name is not available', async () => {
    mockUser()

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByText('あと少しで完了です。組織名を入力してください。')).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('')
  })

  it('組織作成に成功したらプロジェクト作成ステップ（テンプレート選択）へ進む', async () => {
    mockUser({ full_name: '山田太郎', org_name: '株式会社サンプル' })
    mockRpc.mockResolvedValue({ data: { org_id: 'org-1', plan_id: 'free' }, error: null })

    render(<OnboardingPage />)

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

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toBeInTheDocument()
    })
  })

  it('user_metadata.full_name があればプレフィルする', async () => {
    mockUser({ full_name: '山田太郎' })

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toHaveValue('山田太郎')
    })
  })

  it('full_name も name も無ければメールのローカル部をプレフィルする', async () => {
    mockUser({}, 'taro@example.com')

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^あなたの名前\*?$/)).toHaveValue('taro')
    })
  })

  it('組織作成成功時にprofilesへdisplay_nameをupsertする(update ではなく upsert)', async () => {
    mockUser({ full_name: '佐藤花子', org_name: '株式会社テスト' })
    mockRpc.mockResolvedValue({ data: { org_id: 'org-1', plan_id: 'free' }, error: null })

    render(<OnboardingPage />)

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

    render(<OnboardingPage />)

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

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/inbox')
  })

  it('組織もプロジェクトもある場合はプロジェクトへリダイレクト', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: { id: 'space-1' } }

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/org-1/project/space-1')
    })
  })

  it('clientロールは /portal へリダイレクト', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'client' } }

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/portal')
    })
  })

  it('組織あり・プロジェクト無しでは lastPath が残っていても Step2 を表示（/inbox に弾かれない）', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: null }
    localStorage.setItem('taskapp:lastPath', '/inbox')

    render(<OnboardingPage />)

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

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/org-1/project/space-2')
    })
  })

  it('別組織・ポータル等の lastPath は無視して最初のプロジェクトへ', async () => {
    mockUser()
    membershipResponse = { data: { org_id: 'org-1', role: 'owner' } }
    spaceResponse = { data: { id: 'space-1' } }
    localStorage.setItem('taskapp:lastPath', '/other-org/project/space-9')

    render(<OnboardingPage />)

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
    render(<OnboardingPage />)
    await waitFor(() => {
      expect(screen.getByText('最初のプロジェクトを作成')).toBeInTheDocument()
    })
  }

  it('テンプレートを選ぶと create-with-preset API を呼びプロジェクトへ遷移する', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ space: { id: 'space-9' } }),
    }) as unknown as typeof fetch

    await renderStep2()

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), {
      target: { value: 'コーポレートサイト制作' },
    })
    fireEvent.click(screen.getByText('Web/アプリ開発'))

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
      expect(mockPush).toHaveBeenCalledWith('/org-1/project/space-9')
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

    await waitFor(() => {
      expect(screen.getByText('プロジェクトの作成に失敗しました。もう一度お試しください。')).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
    // ピッカーは選び直せる状態のまま
    expect(screen.getByText('Web/アプリ開発')).toBeInTheDocument()
  })

  it('プロジェクト名が空のままテンプレートを選ぶとバリデーションエラー', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch

    await renderStep2()

    fireEvent.change(screen.getByLabelText(/^プロジェクト名\*?$/), { target: { value: '  ' } })
    fireEvent.click(screen.getByText('Web/アプリ開発'))

    await waitFor(() => {
      expect(screen.getByText('プロジェクト名を入力してください。')).toBeInTheDocument()
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

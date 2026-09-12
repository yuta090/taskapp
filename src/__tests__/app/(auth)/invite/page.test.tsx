import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import InviteAcceptPage from '@/app/(auth)/invite/[token]/page'

/**
 * /invite/[token] の受諾動線。
 *
 * V5（vendor-portal で導入済み）と同じ wrong-account join 防止を適用する:
 * ログイン中のメールが招待メールと一致するときだけ自動受諾し、
 * 不一致なら招待を消費せずアカウント切替を案内する。
 * 受諾後の着地は role に応じて分岐（client → /portal、vendor → /vendor-portal）。
 *
 * サインイン識別が変わりうる受諾後の着地・アカウント切替は、ルート常駐のクライアント状態
 * （ActiveOrgProvider・query cache）を作り直すためフルページ遷移（window.location.assign /
 * signOutAndLeave 経由の replace）で行う。招待宛先へのログイン誘導（未受諾のままログインへ）は
 * 識別変化を伴わないので router.push のまま。
 */

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/invite/tok-1',
}))

const mockGetSession = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      signInWithPassword: mockSignInWithPassword,
    },
    rpc: mockRpc,
  }),
}))

const { mockSignOutAndLeave } = vi.hoisted(() => ({
  mockSignOutAndLeave: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

const validInvite = {
  valid: true,
  email: 'invitee@example.com',
  role: 'member',
  org_id: 'org-1',
  org_name: 'テスト株式会社',
  space_id: 'space-1',
  space_name: 'テストプロジェクト',
  inviter_name: '管理者',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  is_existing_user: false,
}

const mockFetch = vi.fn()

function session(email: string) {
  return { data: { session: { user: { id: 'user-1', email } } } }
}

function acceptResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        org_id: 'org-1',
        space_id: 'space-1',
        role: 'member',
        email: validInvite.email,
        created: false,
        ...overrides,
      }),
  }
}

// React の use() は status 付きの fulfilled promise なら同期的に値を返す
// （素の Promise.resolve だと jsdom でサスペンドしたまま復帰しない）
function fulfilledParams<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & { status: string; value: T }
  promise.status = 'fulfilled'
  promise.value = value
  return promise
}

let locationAssignSpy: ReturnType<typeof vi.fn>
let locationReloadSpy: ReturnType<typeof vi.fn>

function renderPage() {
  return render(
    <Suspense fallback={null}>
      <InviteAcceptPage params={fulfilledParams({ token: 'tok-1' })} />
    </Suspense>
  )
}

describe('InviteAcceptPage — 受諾動線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockRpc.mockResolvedValue({ data: { ...validInvite }, error: null })
    mockFetch.mockResolvedValue(acceptResponse())
    mockSignInWithPassword.mockResolvedValue({ error: null })
    locationAssignSpy = vi.fn()
    locationReloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: locationAssignSpy, reload: locationReloadSpy },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ログイン中でメールが一致すれば自動受諾してプロジェクトへ（フルページ遷移）', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))

    renderPage()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/invites/tok-1/accept',
        expect.objectContaining({ method: 'POST' })
      )
    })
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
    })
    expect(mockPush).not.toHaveBeenCalledWith('/org-1/project/space-1')
  })

  it('ログイン中でも別アカウントなら自動受諾せず切替案内を表示（招待を消費しない）', async () => {
    mockGetSession.mockResolvedValue(session('other@example.com'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/別のアカウントでログイン中/)).toBeInTheDocument()
    })
    expect(screen.getByText('other@example.com')).toBeInTheDocument()
    expect(screen.getByText('invitee@example.com')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(locationAssignSpy).not.toHaveBeenCalled()
  })

  // /invite/[token] 自体は公開ページなので to は現在のURLのままでよい。ただしこのボタンは
  // ログイン中に押されるので pushCleanup は既定(true)のまま渡す（push購読の解除は必要）
  it('切替案内から「ログアウトして招待を受ける」で signOutAndLeave({ to: 現在のURL }) を呼ぶ（pushCleanupは既定のまま）', async () => {
    mockGetSession.mockResolvedValue(session('other@example.com'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/別のアカウントでログイン中/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /ログアウトして招待を受ける/ }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: window.location.href })
    })
  })

  it('clientロールの招待は受諾後 /portal へ（内部URLに送らない）', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))
    mockRpc.mockResolvedValue({ data: { ...validInvite, role: 'client' }, error: null })
    mockFetch.mockResolvedValue(acceptResponse({ role: 'client' }))

    renderPage()

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/portal')
    })
    expect(locationAssignSpy).not.toHaveBeenCalledWith('/org-1/project/space-1')
  })

  it('vendorロールの招待は受諾後 /vendor-portal へ（内部URLに送らない）', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))
    mockRpc.mockResolvedValue({ data: { ...validInvite, role: 'vendor' }, error: null })
    mockFetch.mockResolvedValue(acceptResponse({ role: 'vendor' }))

    renderPage()

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/vendor-portal')
    })
    expect(locationAssignSpy).not.toHaveBeenCalledWith('/org-1/project/space-1')
  })

  it('未ログインの新規ユーザーはパスワード設定→受諾→ログイン→プロジェクトへ（回帰・フルページ遷移）', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^パスワードを設定\*?$/)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成して参加' }))

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: validInvite.email,
        password: 'password123',
      })
    })
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
    })
  })

  // アカウント自体は作れたのに直後のログインだけ失敗すると、招待は既に受諾済みで
  // やり直しが利かない（受諾済みトークンは無効になる）。「登録できませんでした」と
  // 誤解させず、ログイン画面へ進めばよいと分かる案内にする
  it('アカウント作成後にログインだけ失敗したら、日本語の案内とログイン画面へのリンクを出す', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^パスワードを設定\*?$/)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成して参加' }))

    await waitFor(() => {
      expect(
        screen.getByText('アカウントは作成しましたが、ログインできませんでした。ログイン画面からログインしてください。')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Invalid login credentials')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ログイン画面へ' })).toHaveAttribute('href', '/login')
  })

  // 回帰: パスワード入力欄への1文字ごとの入力が招待読み込み(getSession/rpc_validate_invite)を
  // 再実行してはならない。acceptInvite が password state を閉じ込めていると、
  // useCallback の参照が毎回変わり、それに依存する読み込み用 useEffect も毎回再実行されてしまう
  it('パスワード入力の1文字ごとに招待の再読み込み（getSession/rpc_validate_invite）が走らない', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^パスワードを設定\*?$/)).toBeInTheDocument()
    })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), { target: { value: 'p' } })
    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), { target: { value: 'pa' } })
    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), { target: { value: 'pas' } })
    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), { target: { value: 'pass' } })
    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), { target: { value: 'password123' } })

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  // 本番バグの再現テスト: 相手先（client）の招待メールが指す /invite/<token> は
  // 未ログインでも開ける公開ページで、初めての相手先はここでパスワードを決めるだけで
  // 参加できる（旧 /portal/<token> は公開ページでなくログイン画面に弾かれ参加できなかった）
  it('未ログイン・アカウント未作成の相手先（client）はパスワード設定→受諾→ログイン→ポータルへ（本番バグの再現・回帰）', async () => {
    mockRpc.mockResolvedValue({ data: { ...validInvite, role: 'client' }, error: null })
    mockFetch.mockResolvedValue(acceptResponse({ role: 'client' }))

    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^パスワードを設定\*?$/)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成して参加' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/invites/tok-1/accept',
        expect.objectContaining({ method: 'POST' })
      )
    })
    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: validInvite.email,
        password: 'password123',
      })
    })
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/portal')
    })
    expect(locationAssignSpy).not.toHaveBeenCalledWith('/org-1/project/space-1')
  })

  // 既存ユーザー×ログイン中×メール一致は本来ログイン直後に自動受諾されるが、通信エラー等で
  // 自動受諾が失敗すると、手動で再試行できるようフォームへフォールバックする。このときのボタン文言は
  // 内部っぽい「チームに参加」ではなく、相手先/ベンダーにも通じる中立な「参加する」であること
  it('既存ユーザーの自動受諾が失敗した場合、手動再試行フォームに中立な文言「参加する」を出す', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))
    mockRpc.mockResolvedValue({ data: { ...validInvite, is_existing_user: true }, error: null })
    mockFetch.mockRejectedValueOnce(new Error('network error'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '参加する' })).toBeInTheDocument()
    })
  })

  // 回帰: パスワード欄が無い既存ユーザーの再試行は、パスワード確認なしの自動受諾パスで
  // 再試行しなければならない。password 引数で受諾する経路のままだと
  // 「パスワードは8文字以上で入力してください」という的外れなエラーになる
  it('既存ユーザーが「参加する」で再試行すると、パスワードなしで受諾APIを呼び直す（誤ったパスワードエラーを出さない）', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))
    mockRpc.mockResolvedValue({ data: { ...validInvite, is_existing_user: true }, error: null })
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    mockFetch.mockResolvedValueOnce(acceptResponse())

    renderPage()

    const retryButton = await screen.findByRole('button', { name: '参加する' })
    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
    const secondCallInit = mockFetch.mock.calls[1][1] as RequestInit
    expect(secondCallInit.body).toBeUndefined()
    expect(screen.queryByText('パスワードは8文字以上で入力してください')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
    })
  })

  // iPhone Safari 等が bfcache（swipe back）からこのページをそのまま復元すると、ページは
  // 実際には破棄されておらず、受諾成功直後に維持している loading を戻す機会が無いまま
  // ボタンが永久に押せなくなる。招待の受諾は取り消せない（受諾済みトークンで再送信すると
  // 「招待リンクが無効です」になる）ため、loading を戻すだけでなく reload() してこのページ
  // 自身の実際の状態から作り直す（コードレビュー指摘）。
  it('受諾成功後にbfcacheから復元されたら、ページを reload() する（loading解除だけにしない）', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^パスワードを設定\*?$/)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成して参加' }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
    })
    expect(screen.getByText('処理中...').closest('button')).toBeDisabled()

    const event = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)

    expect(locationReloadSpy).toHaveBeenCalledTimes(1)
  })

  it('無効なトークンはエラーカードを表示（回帰）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid' } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('招待リンクが無効です')).toBeInTheDocument()
    })
  })

  // apiMfaGuard.ts は { error: 'mfa_required', message: '二要素認証のコード入力が必要です' }
  // という形の403を返す。error（内部の符号）をそのまま出すと "mfa_required" という英語の
  // 内部符号が画面に出てしまうため、message があればそれを優先して出す
  it('二要素認証の門番に断られたら、"mfa_required" ではなくサーバーのmessageを出し、コード入力画面への案内も出す', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'mfa_required', message: '二要素認証のコード入力が必要です' }),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('二要素認証のコード入力が必要です')).toBeInTheDocument()
    })
    expect(screen.queryByText('mfa_required')).not.toBeInTheDocument()
    // コードを入力したあと、いつもの着地点ではなくこの招待ページへ戻す
    // （戻り先が無いと、コード入力後に招待は受けていないまま取り残される）
    expect(screen.getByRole('link', { name: '認証アプリのコードを入力する' })).toHaveAttribute(
      'href',
      '/login/mfa?redirect=%2Finvite%2Ftok-1'
    )
  })

  it('既存ユーザーが未ログインで開いた場合、パスワード入力に到達させずログインへ誘導する（識別変化を伴わないので router.push のまま）', async () => {
    mockRpc.mockResolvedValue({ data: { ...validInvite, is_existing_user: true }, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ログインして参加' })).toBeInTheDocument()
    })

    // パスワード検証に到達させない（手詰まりバグの再現防止）
    expect(screen.queryByLabelText(/パスワードを設定/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '参加する' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ログインして参加' }))

    expect(mockPush).toHaveBeenCalledWith('/login?redirect=/invite/tok-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

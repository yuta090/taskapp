import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import { WikiConflictError } from '@/lib/hooks/useWikiPages'
import type { WikiPage } from '@/types/database'

// 2人（またはAI）が同じ Wiki ページを同時に開いて別々に書いたとき、後から保存した人の
// 内容だけが黙って残り、片方の編集がエラーも警告も無しに消える穴を塞ぐ。保存に基準の
// updated_at を渡し、0行（＝先に書き換えられていた）なら競合の帯を出す。見せかけの競合
// （タイトルだけ変更等で本文は同じ）は基準を差し替えて1回だけ保存をやり直す。

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: '開いているページ',
    body: 'body-v0',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-13T00:00:00+09:00',
    ...overrides,
  }
}

const INITIAL_PAGE = page()
// 【高】3 のテスト用: 別ページ。id が異なるので key(activePage.id を含む)は自然に別物になる。
const PAGE_B = page({ id: 'p2', title: 'ページB', body: 'body-B', updated_at: '2026-09-13T01:00:00+09:00' })

// 開く URL の ?page= を可変にする(既定は p1)。【高】3 のテストだけ書き換えて rerender する。
const searchParamsPageId = vi.hoisted(() => ({ current: 'p1' }))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`page=${searchParamsPageId.current}`),
}))

// 「書きかけをコピー」の成否をトーストで知らせる(【中】6)ことを確かめるため差し替える
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

const mockSetInspector = vi.fn()
vi.mock('@/components/layout', () => {
  const setFullscreen = vi.fn()
  return {
    useInspector: () => ({ setInspector: mockSetInspector }),
    useShellFullscreen: () => ({ fullscreen: false, setFullscreen }),
  }
})

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

const mockFetchPage = vi.hoisted(() => vi.fn())
const mockUpdatePage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useWikiPages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hooks/useWikiPages')>('@/lib/hooks/useWikiPages')
  return {
    WikiConflictError: actual.WikiConflictError,
    useWikiPages: () => ({
      pages: [INITIAL_PAGE],
      loading: false,
      autoCreatedPageId: null,
      fetchPages: vi.fn(),
      createPage: vi.fn(),
      updatePage: mockUpdatePage,
      deletePage: vi.fn(),
      fetchPage: mockFetchPage,
      fetchVersions: vi.fn(),
    }),
  }
})

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [] }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user1' } }),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: true, resolved: true, loading: false }),
}))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))

// エディタは実体(BlockNote)を使わず、マウント回数と受け取った initialContent を数える
// スタブに差し替える。「本文はもともと BlockNote の JSON 文字列」という前提をテストでも
// 再現するため、onChange には JSON.stringify した文字列を渡す。
// initialContents は「エディタが作り直される(=key が変わる)たびに、そのとき渡された
// initialContent を積む」配列。版の復元後に作り直されたか＝ここに復元後の本文が
// 積まれるかで確かめる（key を直接は読めないため）。
const mountCount = vi.hoisted(() => ({ current: 0 }))
const initialContents = vi.hoisted(() => ({ current: [] as Array<string | undefined> }))
// 実際の BlockNote は初期表示直後に一度 onChange(今の内容) を呼ぶ。土台の修正
// (開いただけでは保存しない)を意味のある形でテストするため、スタブでもこれを再現する。
const STUB_CONTENT_1 = 'STUB_CONTENT_1'
const STUB_CONTENT_2 = 'STUB_CONTENT_2'
vi.mock('@/components/wiki/WikiEditorDynamic', async () => {
  const React = await import('react')
  return {
    WikiEditorDynamic: ({ onChange, initialContent }: { onChange?: (content: string) => void; initialContent?: string }) => {
      React.useEffect(() => {
        mountCount.current += 1
        initialContents.current.push(initialContent)
        // BlockNote の「開いた直後に同じ内容で一度 onChange を呼ぶ」挙動を再現する
        onChange?.(initialContent ?? '')
        // マウント回数(=keyが変わって作り直された回数)を数えたいだけなので、
        // 依存配列は意図的に空にする(initialContent の変化では走らせない)
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return React.createElement(
        'div',
        { 'data-testid': 'wiki-editor-stub' },
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'wiki-editor-stub-type',
            onClick: () => onChange?.(STUB_CONTENT_1),
          },
          '入力'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'wiki-editor-stub-type-2',
            onClick: () => onChange?.(STUB_CONTENT_2),
          },
          '入力2'
        )
      )
    },
  }
})

// setInspector には(useWikiPages モックが毎レンダー新しい deletePage を返すため)
// 一時的な null(クリーンアップ)を挟んで何度も呼ばれる。末尾を単純に取ると、たまたま
// null を挟んだ直後を掴んでフレークになるため、直近の「要素(props持ち)」を後ろから探す。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- setInspector は元々型付けされていない引数を受け取るモックのため
function getLastInspectorElement(): any {
  for (let i = mockSetInspector.mock.calls.length - 1; i >= 0; i--) {
    const arg = mockSetInspector.mock.calls[i]?.[0]
    if (arg) return arg
  }
  throw new Error('setInspector に要素が渡された形跡がありません')
}

async function setup() {
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
  // wiki-editor-stub が DOM に出ても、その子や WikiPageClient 自身の useEffect
  // (マウント計測・setInspector呼び出し)がまだ走っていないことがある(waitFor は act() の
  // 外で DOM だけを見て解決し得るため)。同じ waitFor の中で mountCount も確かめることで、
  // その回のレンダーの passive effect が実際に流れ終わるまで待つ(フルスクリーンのテストと同じ形)。
  await waitFor(() => {
    expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument()
    expect(mountCount.current).toBeGreaterThan(0)
  })
}

async function typeAndFlush() {
  fireEvent.click(screen.getByTestId('wiki-editor-stub-type'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
}

describe('WikiPageClient — Wiki 本文保存の競合検知', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSetInspector.mockClear()
    mountCount.current = 0
    initialContents.current = []
    searchParamsPageId.current = 'p1'
    toastMock.success.mockClear()
    toastMock.error.mockClear()
    mockFetchPage.mockReset().mockResolvedValue(INITIAL_PAGE)
    mockUpdatePage.mockReset().mockResolvedValue({ updatedAt: '2026-09-13T00:05:00+09:00' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('本文の自動保存は、開いたときに読んだ updated_at を基準として渡す', async () => {
    await setup()
    await typeAndFlush()

    expect(mockUpdatePage).toHaveBeenCalledWith(
      'p1',
      { body: expect.any(String) },
      '2026-09-13T00:00:00+09:00'
    )
  })

  it('見せかけの競合（本文は同じ・他の更新でupdated_atだけ進んだ）は基準を差し替えて1回だけ保存をやり直す', async () => {
    mockUpdatePage
      .mockRejectedValueOnce(new WikiConflictError())
      .mockResolvedValueOnce({ updatedAt: '2026-09-13T00:10:00+09:00' })
    // 競合確認の読み直し: 本文(body)は開いたときと同じ 'body-v0'（他の人はタイトル等だけ変えた）
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE) // 画面を開いたときの読み込み
      .mockResolvedValueOnce(page({ body: 'body-v0', title: '変更後タイトル', updated_at: '2026-09-13T00:08:00+09:00' }))

    await setup()
    await typeAndFlush()

    expect(mockUpdatePage).toHaveBeenCalledTimes(2)
    expect(mockUpdatePage).toHaveBeenNthCalledWith(2, 'p1', { body: expect.any(String) }, '2026-09-13T00:08:00+09:00')
    expect(screen.queryByTestId('wiki-conflict-banner')).not.toBeInTheDocument()
  })

  it('本当の競合（本文が違う）では帯を出し、以後の自動保存を止める', async () => {
    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE)
      .mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))

    await setup()
    await typeAndFlush()

    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()
    expect(screen.getByText(/ほかの人（またはAI）が先に書き換えました/)).toBeInTheDocument()

    // 競合中にさらに入力しても、新しい保存は投げない
    mockUpdatePage.mockClear()
    await typeAndFlush()
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  it('「書きかけをコピー」は今の書きかけをクリップボードへ入れる', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE)
      .mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))

    await setup()
    await typeAndFlush()
    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByText('書きかけをコピー'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(STUB_CONTENT_1))
  })

  it('「最新を読み込む」で読み直し、帯が消えてエディタが作り直される', async () => {
    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE)
      .mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))

    await setup()
    await typeAndFlush()
    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()
    expect(mountCount.current).toBe(1)

    mockFetchPage.mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))

    await act(async () => {
      fireEvent.click(screen.getByText('最新を読み込む'))
    })

    await waitFor(() => expect(screen.queryByTestId('wiki-conflict-banner')).not.toBeInTheDocument())
    expect(mountCount.current).toBe(2)
  })

  it('ページ情報パネルでの属性更新の後でも、次の本文保存は最新の updated_at を基準にする（偽の競合を出さない）', async () => {
    await setup()

    // setInspector に渡された要素の props から onUpdate を直接呼ぶ（viewerReadonly と同じ手法）
    const inspectorElement = getLastInspectorElement()
    expect(inspectorElement?.props?.onUpdate).toBeInstanceOf(Function)

    mockFetchPage.mockResolvedValueOnce(page({ title: '新しいタイトル', updated_at: '2026-09-13T00:03:00+09:00' }))
    await act(async () => {
      await inspectorElement.props.onUpdate({ title: '新しいタイトル' })
    })

    await typeAndFlush()

    expect(mockUpdatePage).toHaveBeenLastCalledWith(
      'p1',
      { body: expect.any(String) },
      '2026-09-13T00:03:00+09:00'
    )
  })

  // レビュー指摘: 版を復元しても WikiEditorDynamic の key が変わらないと、画面には
  // 復元前の本文が残ったまま（initialContent は最初にマウントしたときの値のまま）になり、
  // その状態で1文字打つと handleEditorChange が復元前の本文を保存して復元が取り消されて
  // しまう。editorReloadToken を key に含めて作り直すことでこれを防いでいる。
  it('版を復元すると updatePage が版の本文で呼ばれたあと、エディタが作り直され、復元した本文が initialContent になる', async () => {
    await setup()
    expect(mountCount.current).toBe(1)
    expect(initialContents.current).toEqual(['body-v0'])

    // WikiPageInspector は中身をスタブに差し替えているため、setInspector に渡された
    // 要素の props から onRestoreVersion を直接呼ぶ（onUpdate と同じ手法）
    const inspectorElement = getLastInspectorElement()
    expect(inspectorElement?.props?.onRestoreVersion).toBeInstanceOf(Function)

    mockFetchPage.mockResolvedValueOnce(
      page({ body: 'restored-body', title: '復元タイトル', updated_at: '2026-09-13T00:09:00+09:00' })
    )

    await act(async () => {
      inspectorElement.props.onRestoreVersion({
        id: 'v1',
        org_id: 'org1',
        page_id: 'p1',
        title: '復元タイトル',
        body: 'restored-body',
        created_by: 'user1',
        created_at: '2026-09-13T00:05:00+09:00',
      })
      // handleRestoreVersion は呼び出し元で await されない(.then で続く)ため、
      // 内部の updatePage → fetchPage の連鎖ぶんだけマイクロタスクを流す
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 【中】7: 版の復元も基準(baseUpdatedAt)を渡す
    expect(mockUpdatePage).toHaveBeenCalledWith(
      'p1',
      { body: 'restored-body', title: '復元タイトル' },
      '2026-09-13T00:00:00+09:00'
    )
    expect(mountCount.current).toBe(2)
    expect(initialContents.current.at(-1)).toBe('restored-body')
  })

  it('復元後に本文を編集すると、復元後に読み直した updated_at を基準に保存が走る（古い基準で上書きされない）', async () => {
    await setup()

    const inspectorElement = getLastInspectorElement()
    mockFetchPage.mockResolvedValueOnce(
      page({ body: 'restored-body', title: '復元タイトル', updated_at: '2026-09-13T00:09:00+09:00' })
    )

    await act(async () => {
      inspectorElement.props.onRestoreVersion({
        id: 'v1',
        org_id: 'org1',
        page_id: 'p1',
        title: '復元タイトル',
        body: 'restored-body',
        created_by: 'user1',
        created_at: '2026-09-13T00:05:00+09:00',
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    mockUpdatePage.mockClear()
    await typeAndFlush()

    // 復元前(開いたときに読んだ 2026-09-13T00:00:00+09:00)ではなく、復元後に読み直した
    // updated_at(2026-09-13T00:09:00+09:00)を基準として使っている
    expect(mockUpdatePage).toHaveBeenCalledWith(
      'p1',
      { body: expect.any(String) },
      '2026-09-13T00:09:00+09:00'
    )
  })

  // 土台(【高】3の前提): BlockNote は初期表示直後に一度、今の内容のまま onChange を呼ぶ。
  // これを保存しない比較(knownServerBodyRef との一致)が無いと、ページを開くだけで保存が
  // 走り、版の履歴が無駄に増える。
  it('土台: ページを開いただけでは保存が走らない', async () => {
    await setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  // 【高】1: 保留中の（まだ発火していない）デバウンス保存を止めずに基準を差し替えると、
  // 帯を出したあとに古い書きかけが新しい基準で保存されてしまう。
  // 保存を予約したまま(T2)「最新を読み込む」を押しても、その予約が後から発火して
  // 保存を送らないことをエンドツーエンドで確かめる。Wiki の直しは何重かの砦が重なって
  // この結果を保証する: ①ここで直した明示クリア(【高】1本体・handleReloadLatestの先頭)
  // ②conflictRef が競合中は再スケジュールを止める(【高】2) ③本文が読み直した内容と
  // 一致すればそもそも保存しない(【高】3の土台)。削除済み(fresh===null)の経路は
  // conflictRef を true のまま維持する設計のため、明示クリアを外しても②に守られてしまい
  // 単体では見分けが付かない。それでも「予約が発火しても保存は送られない」という
  // 利用者から見える結果自体は、どの砦が効いていても壊れてはいけないので、それを確かめる。
  it('【高】1: 保存を予約した状態で「最新を読み込む」を押すと、その予約が発火しても保存が送られない', async () => {
    let rejectFirstUpdate: (err: unknown) => void = () => {}
    mockUpdatePage.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirstUpdate = reject }))
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE) // 開いたときの読み込み
      .mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' })) // T1の競合確認
      .mockResolvedValueOnce(null) // 最新を読み込む → 削除されていた

    await setup()

    // T1: 最初の保存を発火させる(まだ通信中=未解決のまま)
    fireEvent.click(screen.getByTestId('wiki-editor-stub-type'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    // T1 がまだ通信中の間にもう一度打つ → T2(新しいデバウンスタイマー)が予約される
    fireEvent.click(screen.getByTestId('wiki-editor-stub-type-2'))

    // T1 を「本当の競合」で終わらせる
    await act(async () => {
      rejectFirstUpdate(new WikiConflictError())
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()

    mockUpdatePage.mockClear()

    // 帯が出ている間(=T2はまだ発火していない)に「最新を読み込む」を押す(先は削除済み)
    await act(async () => {
      fireEvent.click(screen.getByText('最新を読み込む'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/見つかりませんでした/)).toBeInTheDocument()

    // T2 が本来発火するはずだった時刻を過ぎても、保存は送られない
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  // 版の復元でも同じ結果(予約が発火しても保存されない)をエンドツーエンドで確かめる。
  // 復元は成功すると必ずエディタを作り直す(初回 onChange が復元後の本文と一致し、
  // 【高】3の土台がついでに保留分も止める)ため、明示クリア単体を機械的に切り分けては
  // いないが、利用者から見える結果(黙って取り消されない)はどちらの砦でも守られる。
  it('【高】1(版の復元): 保存を予約した状態で版を復元すると、その予約が発火しても保存が送られない', async () => {
    await setup()

    // T1: まだ発火していないデバウンスタイマーを予約したままにする
    fireEvent.click(screen.getByTestId('wiki-editor-stub-type'))

    mockFetchPage.mockResolvedValueOnce(
      page({ body: 'restored-body', title: '復元タイトル', updated_at: '2026-09-13T00:09:00+09:00' })
    )
    const inspectorElement = getLastInspectorElement()
    mockUpdatePage.mockClear()
    await act(async () => {
      inspectorElement.props.onRestoreVersion({
        id: 'v1',
        org_id: 'org1',
        page_id: 'p1',
        title: '復元タイトル',
        body: 'restored-body',
        created_by: 'user1',
        created_at: '2026-09-13T00:05:00+09:00',
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // ここまでで updatePage は「復元」の1回だけ呼ばれている
    expect(mockUpdatePage).toHaveBeenCalledTimes(1)
    mockUpdatePage.mockClear()

    // T1 が本来発火するはずだった時刻を過ぎても、古い書きかけの保存は送られない
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  // 【高】2: conflict が React state だけだと、setConflict 後も再描画前の古い closure
  // (通信中に張られたタイマー等)は「まだ競合していない」と誤判定し得る。ref で同期に見る。
  it('【高】2: 競合の判定中(updatePageが未解決)に編集が来ても新しいupdatePageは積まれず、競合確定後は送らない', async () => {
    let rejectFirst: (err: unknown) => void = () => {}
    mockUpdatePage.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE)
      .mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))

    await setup()
    fireEvent.click(screen.getByTestId('wiki-editor-stub-type'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // T1発火・通信中(未解決)
    })

    fireEvent.click(screen.getByTestId('wiki-editor-stub-type-2')) // 通信中の編集 → T2予約
    mockUpdatePage.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // T2 が本来発火する時刻
    })
    // T1がまだ通信中なら、この時点で新しい updatePage は呼ばれない
    expect(mockUpdatePage).not.toHaveBeenCalled()

    // T1 が「本当の競合」で終わる
    await act(async () => {
      rejectFirst(new WikiConflictError())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()

    // 競合が確定した後、保留していた編集は送られない
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  // 【高】3: ページ切り替え中(selectedPageIdは新ページ・activePageはまだ前ページ)の一瞬に
  // editorReloadTokenを0へ戻すと、key が変わって前ページの本文で新ページのエディタが
  // 作り直される。0へ戻さないことでこの作り直し自体を防ぐ(結果として、土台の baseline
  // 比較が万一無くても安全なように)。エンドツーエンドでは Bを開いた直後に保存や偽の帯が
  // 出ないことを確かめる。
  it('【高】3: ページAでtokenを進めた状態でBに切り替えても、Aの本文で保存が走らずBに偽の帯が出ない', async () => {
    mockFetchPage.mockImplementation(async (id: string) => {
      if (id === 'p1') return INITIAL_PAGE
      if (id === 'p2') return PAGE_B
      return null
    })

    const { rerender } = render(<WikiPageClient orgId="org1" spaceId="space1" />)
    await waitFor(() => {
      expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument()
      expect(mountCount.current).toBeGreaterThan(0)
    })

    // ページAで競合→「最新を読み込む」を経由して editorReloadToken を進めておく
    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())
    mockFetchPage.mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))
    fireEvent.click(screen.getByTestId('wiki-editor-stub-type'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()
    mockFetchPage.mockResolvedValueOnce(page({ body: 'Aの最新本文', updated_at: '2026-09-13T00:09:00+09:00' }))
    await act(async () => {
      fireEvent.click(screen.getByText('最新を読み込む'))
    })
    expect(screen.queryByTestId('wiki-conflict-banner')).not.toBeInTheDocument()

    // B へ切り替える
    searchParamsPageId.current = 'p2'
    mockUpdatePage.mockClear()
    rerender(<WikiPageClient orgId="org1" spaceId="space1" />)

    await waitFor(() => expect(screen.getByText('ページB')).toBeInTheDocument())

    // B を開いた直後、何もしなくても保存やタイマーが走っていないか確かめる
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(mockUpdatePage).not.toHaveBeenCalled()
    expect(screen.queryByTestId('wiki-conflict-banner')).not.toBeInTheDocument()
  })

  // 【中】4: 保存が同時に2本走ると、到着順の入れ替わりで古い内容が新しい基準で書かれ得る。
  it('【中】4: 保存中に来た編集は二重送信にならず、最後の内容で1回だけ届く', async () => {
    let resolveFirst: (v: { updatedAt: string }) => void = () => {}
    mockUpdatePage.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    mockUpdatePage.mockResolvedValueOnce({ updatedAt: '2026-09-13T00:06:00+09:00' })

    await setup()
    fireEvent.click(screen.getByTestId('wiki-editor-stub-type')) // content1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // T1発火・通信中(未解決)
    })

    fireEvent.click(screen.getByTestId('wiki-editor-stub-type-2')) // 通信中に content2 で編集
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // T2が本来発火する時刻を過ぎても送られない
    })
    expect(mockUpdatePage).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst({ updatedAt: '2026-09-13T00:05:00+09:00' }) // T1成功
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 保留していた分がここで初めて1回だけ、最後の内容(content2)で送られる
    expect(mockUpdatePage).toHaveBeenCalledTimes(2)
    expect(mockUpdatePage).toHaveBeenNthCalledWith(2, 'p1', { body: STUB_CONTENT_2 }, '2026-09-13T00:05:00+09:00')
  })

  // 【中】5: 0行の原因は競合とは限らない。ページ自体が削除されていても0行になり得る。
  it('【中】5: 削除されたページ(fetchPageがnull)は「見つかりません」の帯になり、自動保存は止まったまま', async () => {
    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE)
      .mockResolvedValueOnce(null) // 競合確認の読み直しで削除が判明

    await setup()
    await typeAndFlush()

    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()
    expect(screen.getByText(/見つかりませんでした/)).toBeInTheDocument()
    expect(screen.queryByText('最新を読み込む')).not.toBeInTheDocument()

    // 以後に編集しても自動保存は止まったまま
    mockUpdatePage.mockClear()
    await typeAndFlush()
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  // 【中】6: クリップボードが使えない環境では黙って失敗していた。成否をトーストで知らせる。
  it('【中】6: 「書きかけをコピー」は成功/失敗をトーストで知らせる', async () => {
    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())
    mockFetchPage
      .mockResolvedValueOnce(INITIAL_PAGE)
      .mockResolvedValueOnce(page({ body: '他の人が書いた本文', updated_at: '2026-09-13T00:08:00+09:00' }))

    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no clipboard'))
    Object.assign(navigator, { clipboard: { writeText } })

    await setup()
    await typeAndFlush()
    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByText('書きかけをコピー'))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('書きかけをコピーしました'))

    fireEvent.click(screen.getByText('書きかけをコピー'))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('コピーできませんでした'))
  })

  // 【中】7: 版の復元が競合したときも、本文保存と同じ帯にそのまま乗せる
  it('【中】7: 版の復元が競合したら、同じ帯が出る', async () => {
    mockUpdatePage.mockRejectedValueOnce(new WikiConflictError())

    await setup()
    const inspectorElement = getLastInspectorElement()
    await act(async () => {
      inspectorElement.props.onRestoreVersion({
        id: 'v1',
        org_id: 'org1',
        page_id: 'p1',
        title: '復元タイトル',
        body: 'restored-body',
        created_by: 'user1',
        created_at: '2026-09-13T00:05:00+09:00',
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('wiki-conflict-banner')).toBeInTheDocument()
  })
})

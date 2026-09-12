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
  useSearchParams: () => new URLSearchParams('page=p1'),
}))

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
vi.mock('@/components/wiki/WikiEditorDynamic', async () => {
  const React = await import('react')
  return {
    WikiEditorDynamic: ({ onChange, initialContent }: { onChange?: (content: string) => void; initialContent?: string }) => {
      React.useEffect(() => {
        mountCount.current += 1
        initialContents.current.push(initialContent)
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
            onClick: () => onChange?.(JSON.stringify([{ type: 'paragraph', content: '書きかけの内容' }])),
          },
          '入力'
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

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify([{ type: 'paragraph', content: '書きかけの内容' }])))
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

    expect(mockUpdatePage).toHaveBeenCalledWith('p1', { body: 'restored-body', title: '復元タイトル' })
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
})

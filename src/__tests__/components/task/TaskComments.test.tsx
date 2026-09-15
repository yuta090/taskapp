import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskComments } from '@/components/task/TaskComments'
import type { SpaceMember } from '@/lib/hooks/useSpaceMembers'

const mockCreateComment = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/useTaskComments', () => ({
  useTaskComments: () => ({
    comments: [],
    loading: false,
    error: null,
    fetchComments: vi.fn(),
    createComment: mockCreateComment,
    updateComment: vi.fn(),
    softDeleteComment: vi.fn(),
    canEdit: () => false,
  }),
}))

const mockMarkRead = vi.fn()

vi.mock('@/lib/hooks/useUnreadTaskComments', () => ({
  useMarkTaskCommentsReadWhenSeen: (args: unknown) => mockMarkRead(args),
}))

const editor: SpaceMember = { id: 'editor-1', displayName: '編集イチロー', avatarUrl: null, role: 'editor' }
const admin: SpaceMember = { id: 'admin-1', displayName: '管理者アリス', avatarUrl: null, role: 'admin' }
const clientMember: SpaceMember = { id: 'client-1', displayName: 'クライアント江里子', avatarUrl: null, role: 'client' }

vi.mock('@/lib/hooks/useSpaceMembers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hooks/useSpaceMembers')>(
    '@/lib/hooks/useSpaceMembers'
  )
  return {
    ...actual,
    useSpaceMembers: () => ({
      members: [editor, admin, clientMember],
      clientMembers: [clientMember],
      internalMembers: [editor, admin],
      loading: false,
      isPending: false,
      error: null,
      refetch: vi.fn(),
      patchMembers: vi.fn(),
      getMemberName: (id: string) => [editor, admin, clientMember].find((m) => m.id === id)?.displayName ?? id,
    }),
  }
})

beforeEach(() => {
  mockCreateComment.mockClear()
  mockMarkRead.mockClear()
})

describe('TaskComments — 画面に入ったら未読のコメントを既読にする', () => {
  it('そのタスクと、自分以外の最新のコメント（無ければ null）と、コメント一覧の要素を渡す', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)

    expect(mockMarkRead).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', orgId: 'o1', latestComment: null, targetRef: expect.any(Object) })
    )
  })
})

/**
 * A2: 内部ユーザーがコメントを書くとき、既定の公開範囲は「社内のみ」にする
 * (これまでの既定「外部に公開」だと、意図せずクライアントに見える下書きが漏れやすい)。
 */
describe('TaskComments — コメント可視性の初期値 (A2)', () => {
  it('canSetVisibility=true のとき、初期状態で「社内のみ」がアクティブになっている', () => {
    render(
      <TaskComments
        orgId="o1"
        spaceId="s1"
        taskId="t1"
        currentUserId="u1"
        canSetVisibility
      />
    )

    const internalButton = screen.getByRole('button', { name: /社内のみ/ })
    const clientButton = screen.getByRole('button', { name: /外部に公開/ })

    expect(internalButton.className).toContain('bg-gray-200')
    expect(clientButton.className).not.toContain('bg-amber-100')
  })
})

describe('TaskComments — @メンション', () => {
  function typeComment(textarea: HTMLTextAreaElement, value: string) {
    fireEvent.change(textarea, { target: { value } })
  }

  it('@ を打つと候補の一覧が開く', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')

    expect(screen.getByRole('listbox', { name: 'メンション候補' })).toBeInTheDocument()
    expect(screen.getByText('編集イチロー')).toBeInTheDocument()
    expect(screen.getByText('管理者アリス')).toBeInTheDocument()
    expect(screen.getByText('クライアント江里子')).toBeInTheDocument()
  })

  it('自分自身は候補に出さない', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="editor-1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')

    expect(screen.queryByText('編集イチロー')).not.toBeInTheDocument()
  })

  it('↓キーで選択中の候補が動く', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })

    const optionsAfter = screen.getAllByRole('option')
    expect(optionsAfter[0]).toHaveAttribute('aria-selected', 'false')
    expect(optionsAfter[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('候補が開いている間、修飾キー無しの Enter は選択に使い送信しない', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(mockCreateComment).not.toHaveBeenCalled()
    expect(textarea.value).toBe('@編集イチロー ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('日本語入力の変換を確定する Enter では候補を選ばない', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true, keyCode: 229 })

    expect(textarea.value).toBe('@')
    expect(screen.getByRole('listbox', { name: 'メンション候補' })).toBeInTheDocument()
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  it('候補が開いていても Cmd+Enter は送信する（選択と衝突しない）', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, 'お願いします @')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(mockCreateComment).toHaveBeenCalledTimes(1)
  })

  it('クリックで候補を決定すると @表示名 が差し込まれる', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    fireEvent.mouseDown(screen.getByText('管理者アリス'))

    expect(textarea.value).toBe('@管理者アリス ')
  })

  it('送信すると、本文に残っている @表示名 の人の ID を mentionUserIds として渡す', async () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    fireEvent.mouseDown(screen.getByText('編集イチロー'))
    typeComment(textarea, '@編集イチロー お願いします')

    fireEvent.click(screen.getByRole('button', { name: /送信/ }))

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ mentionUserIds: ['editor-1'] })
    )
  })

  // 課題3(a): 公開範囲を切り替えて候補が減ったあと、古い選択番号のまま Enter を
  // 押すと mentionCandidates[activeIndex] が undefined になり TypeError で落ちていた
  it('公開範囲を切り替えると @候補の一覧を閉じる（選択番号が範囲外のまま残らない）', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" canSetVisibility />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    fireEvent.click(screen.getByRole('button', { name: /外部に公開/ }))
    typeComment(textarea, '@')
    expect(screen.getByRole('listbox', { name: 'メンション候補' })).toBeInTheDocument()
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })

    fireEvent.click(screen.getByRole('button', { name: /社内のみ/ }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(() => fireEvent.keyDown(textarea, { key: 'Enter' })).not.toThrow()
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  // 課題3(b): 「@山」のあとカーソルを別の場所へ動かして Enter を押すと、一覧は
  // 更新されず、古い @ の位置に名前が差し込まれカーソルも飛んでいた
  it('カーソルを動かすと @候補を取り直し、古い @ の位置には差し込まない', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@編')
    expect(screen.getByRole('listbox', { name: 'メンション候補' })).toBeInTheDocument()

    // カーソルを先頭へ移動（クリックしたつもり）。先頭には @ が無いので一覧は閉じる
    textarea.setSelectionRange(0, 0)
    fireEvent.click(textarea)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(textarea.value).toBe('@編')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  it('入力欄からフォーカスが外れると一覧を閉じるが、候補のクリックは mousedown で先に確定するので選べる', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    fireEvent.mouseDown(screen.getByText('編集イチロー'))
    expect(textarea.value).toBe('@編集イチロー ')

    typeComment(textarea, '@')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(textarea)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('選んだあとに @表示名 を消したら mentionUserIds に含めない', () => {
    render(<TaskComments orgId="o1" spaceId="s1" taskId="t1" currentUserId="u1" />)
    const textarea = screen.getByPlaceholderText(/コメントを入力/) as HTMLTextAreaElement

    typeComment(textarea, '@')
    fireEvent.mouseDown(screen.getByText('編集イチロー'))
    // メンションを消して書き直す
    typeComment(textarea, 'やっぱりいいです')

    fireEvent.click(screen.getByRole('button', { name: /送信/ }))

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ mentionUserIds: [] })
    )
  })
})

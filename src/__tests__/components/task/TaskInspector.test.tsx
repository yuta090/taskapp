import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { ComponentProps } from 'react'
import type { Task } from '@/types/database'

function renderInspector(props: ComponentProps<typeof TaskInspector>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskInspector {...props} />
    </QueryClientProvider>
  )
}

// S4: ball='client' ⟹ client_scope='deliverable' 不変条件のUI側テスト。

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [],
    clientMembers: [],
    internalMembers: [],
    loading: false,
    error: null,
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: [] }),
}))

vi.mock('@/lib/hooks/useSpaceSettings', () => ({
  useSpaceSettings: () => ({ shouldShowOwnerField: true }),
}))

vi.mock('@/lib/hooks/useAgencyMode', () => ({
  useAgencyMode: () => ({
    data: { agency_mode: false, default_margin_rate: null, vendor_settings: { show_client_name: false, allow_client_comments: false } },
    loading: false,
    update: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useLatestClientAction', () => ({
  useLatestClientAction: () => null,
}))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

// TaskInspector fetches milestones on mount (.from('milestones').select().eq().order()).
// Stub the chain so it resolves cleanly instead of rejecting with "not a function".
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'サンプルタスク',
    description: null,
    status: 'backlog',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    due_authority_connection_id: null,
    short_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('TaskInspector — client_scope 編集と ball=client 不変条件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('client_scope を編集すると onUpdate が clientScope を伴って呼ばれる', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })

    fireEvent.click(screen.getByTestId('task-inspector-client-scope-toggle'))

    expect(onUpdate).toHaveBeenCalledWith({ clientScope: 'deliverable' })
  })

  it('ball=client のタスクは client_scope トグルが disabled になり、internal へ変更できない', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderInspector({
      task: makeTask({ ball: 'client', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })

    const toggle = screen.getByTestId('task-inspector-client-scope-toggle')
    expect(toggle).toBeDisabled()

    fireEvent.click(toggle)

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('ball=client のタスクには自動公開の注記が表示される', () => {
    renderInspector({
      task: makeTask({ ball: 'client', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(
      screen.getByText('外部ボールのタスクは自動的にクライアント公開になります')
    ).toBeInTheDocument()
  })

  it('onUpdate が無い（読み取り専用）場合はトグルを表示せずテキストのみ表示する', () => {
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
    })

    expect(screen.queryByTestId('task-inspector-client-scope-toggle')).not.toBeInTheDocument()
    expect(screen.getByText('公開中')).toBeInTheDocument()
  })
})

describe('TaskInspector — 完了タスクの「クライアント確認待ち」バッジ抑止', () => {
  // TaskRow側は #172 で status=done を除外済み。インスペクタ側の取り残し回帰テスト。
  it('status=done かつ ball=client のときバッジを表示しない', () => {
    renderInspector({
      task: makeTask({ ball: 'client', status: 'done', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.queryByText('クライアント確認待ち')).not.toBeInTheDocument()
  })

  it('status!=done かつ ball=client のときは引き続きバッジを表示する', () => {
    renderInspector({
      task: makeTask({ ball: 'client', status: 'in_progress', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
  })
})

// ボールの補足は常時表示（A3）から「?」ヘルプアイコンの中へ移した。
// 狭い枠に説明文を敷き詰めるより、必要な人だけが開ける形にする。
describe('TaskInspector — ボールの説明はヘルプアイコンの中', () => {
  it('ボールのラベルの右に「?」ヘルプがあり、既定では説明文を出さない', () => {
    renderInspector({
      task: makeTask({ ball: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByRole('button', { name: /ボールの補足/ })).toBeInTheDocument()
    expect(
      screen.queryByText('次にアクションを取る側。外部=クライアントの対応待ち')
    ).not.toBeInTheDocument()
  })

  it('「?」を押すと説明文が開く', () => {
    renderInspector({
      task: makeTask({ ball: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    fireEvent.click(screen.getByRole('button', { name: /ボールの補足/ }))

    expect(
      screen.getByText('次にアクションを取る側。外部=クライアントの対応待ち')
    ).toBeInTheDocument()
  })
})

// AI秘書 Stage5 期限リマインド PR-0(§2.1/§5.2): due_authority_connection_id 非NULL(external権威)の
// タスクは期限(due_date)を TaskApp から編集不可。UIは読み取り専用表示＋出所の注記にする。
describe('TaskInspector — 期限の正本境界(due_authority_connection_id)', () => {
  it('due_authority_connection_id が非NULL のとき、期限は読み取り専用になり編集用の入力を出さない', () => {
    renderInspector({
      task: makeTask({ due_date: '2026-07-25', due_authority_connection_id: 'conn-gtasks-1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.queryByTestId('task-inspector-due-date')).not.toBeInTheDocument()
    expect(screen.getByText('2026/7/25')).toBeInTheDocument()
    expect(screen.getByText(/連携元ツール|Google Tasks/)).toBeInTheDocument()
  })

  it('due_authority_connection_id が非NULL でも開始日は引き続き編集できる(期限だけが読取専用)', () => {
    renderInspector({
      task: makeTask({ start_date: '2026-07-01', due_authority_connection_id: 'conn-gtasks-1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByTestId('task-inspector-start-date')).toBeInTheDocument()
  })

  it('due_authority_connection_id が null のときは従来通り期限を編集できる', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderInspector({
      task: makeTask({ due_date: null, due_authority_connection_id: null }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })

    expect(screen.getByTestId('task-inspector-due-date')).toBeInTheDocument()
    expect(screen.queryByText(/連携元ツール|Google Tasks/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('task-inspector-due-date'), { target: { value: '2026-08-01' } })
    expect(onUpdate).toHaveBeenCalledWith({ dueDate: '2026-08-01' })
  })
})

// 説明欄が「どこからどこまでが説明か」一目で分かるよう、背景色＋罫線で囲った領域にする。
describe('TaskInspector — 説明は区切られた領域として見える', () => {
  it('説明のラベルを含む枠に背景色と罫線が付いている', () => {
    renderInspector({
      task: makeTask({ description: '説明のテキスト' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    const section = screen.getByText('説明').closest('div')
    expect(section?.className).toMatch(/\bbg-gray-50\b/)
    expect(section?.className).toMatch(/\bborder-gray-200\b/)
  })

  it('読み取り専用（onUpdate なし）でも同じ枠で囲む', () => {
    renderInspector({
      task: makeTask({ description: '説明のテキスト' }),
      spaceId: 's1',
      onClose: vi.fn(),
    })

    const section = screen.getByText('説明').closest('div')
    expect(section?.className).toMatch(/\bbg-gray-50\b/)
    expect(section?.className).toMatch(/\bborder-gray-200\b/)
  })
})

// 「クライアント公開」は何を切り替える項目か伝わらないので、ボールと同じ「?」ヘルプを添える。
describe('TaskInspector — クライアント公開の説明はヘルプアイコンの中', () => {
  const HELP_TEXT =
    'ONにすると、このタスクがクライアント用の画面（ポータル）に表示されます。OFFなら社内だけに見えます'

  it('クライアント公開のラベルの右に「?」ヘルプがあり、既定では説明文を出さない', () => {
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByRole('button', { name: /クライアント公開の補足/ })).toBeInTheDocument()
    expect(screen.queryByText(HELP_TEXT)).not.toBeInTheDocument()
  })

  it('「?」を押すと説明文が開く', () => {
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    fireEvent.click(screen.getByRole('button', { name: /クライアント公開の補足/ }))

    expect(screen.getByText(HELP_TEXT)).toBeInTheDocument()
  })

  it('読み取り専用（onUpdate なし）でもヘルプは出す', () => {
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
    })

    expect(screen.getByRole('button', { name: /クライアント公開の補足/ })).toBeInTheDocument()
  })
})

// 長い説明を4行の固定枠で書くのは辛いので、入力欄は中身に合わせて伸びるようにする。
// 保存して編集を閉じれば従来どおりの本文表示に戻る（伸びるのは編集中だけ）。
describe('TaskInspector — 説明の入力欄は書いた量に合わせて伸びる', () => {
  // jsdom はレイアウトを持たず scrollHeight が常に 0 なので、実ブラウザの
  // 「中身のぶんだけ高さがある」状態を差し替えて再現する。
  function stubScrollHeight(px: number) {
    const original = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => px,
    })
    return () => {
      if (original) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', original)
      else Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight')
    }
  }

  function openDescriptionEditor(description: string | null = null) {
    renderInspector({
      task: makeTask({ description }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText(description ?? 'クリックして説明を追加...'))
    return screen.getByTestId('task-inspector-description-input') as HTMLTextAreaElement
  }

  it('初期の高さが4行より広く、縦方向は手でも広げられる', () => {
    const textarea = openDescriptionEditor()

    expect(Number(textarea.getAttribute('rows'))).toBeGreaterThanOrEqual(6)
    expect(textarea.className).toMatch(/\bresize-y\b/)
    expect(textarea.className).not.toMatch(/\bresize-none\b/)
  })

  it('伸びすぎないよう上限があり、超えたら中でスクロールする', () => {
    const textarea = openDescriptionEditor()

    expect(textarea.className).toMatch(/max-h-\[/)
    expect(textarea.className).toMatch(/\boverflow-y-auto\b/)
  })

  it('編集を開いた時点で、既にある本文の長さに合わせた高さになる', () => {
    const restore = stubScrollHeight(320)
    try {
      const textarea = openDescriptionEditor('とても長い説明')
      expect(textarea.style.height).toBe('320px')
    } finally {
      restore()
    }
  })

  it('書き足すと、その量に合わせて高さが伸びる', () => {
    const textarea = openDescriptionEditor()
    const restore = stubScrollHeight(480)
    try {
      fireEvent.change(textarea, { target: { value: '行\n'.repeat(20) } })
      expect(textarea.style.height).toBe('480px')
    } finally {
      restore()
    }
  })

  it('手で高さを変えたあとは、その高さを保って勝手に戻さない', () => {
    const textarea = openDescriptionEditor()

    // ドラッグで広げた状態（ブラウザは inline style の height を書き換える）
    textarea.style.height = '400px'

    const restore = stubScrollHeight(600)
    try {
      fireEvent.change(textarea, { target: { value: 'さらに書き足す' } })
      expect(textarea.style.height).toBe('400px')
    } finally {
      restore()
    }
  })
})

// 長文を書き終えたあと保存ボタンまでマウスを動かさずに済むようにする。
describe('TaskInspector — 説明は Cmd/Ctrl + Enter でも保存できる', () => {
  function openEditor(onUpdate: ComponentProps<typeof TaskInspector>['onUpdate']) {
    renderInspector({
      task: makeTask({ description: null }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })
    fireEvent.click(screen.getByText('クリックして説明を追加...'))
    return screen.getByTestId('task-inspector-description-input') as HTMLTextAreaElement
  }

  it('Cmd + Enter で保存され、編集欄が閉じる', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const textarea = openEditor(onUpdate)

    fireEvent.change(textarea, { target: { value: '新しい説明' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ description: '新しい説明' }))
    await waitFor(() =>
      expect(screen.queryByTestId('task-inspector-description-input')).not.toBeInTheDocument()
    )
  })

  it('Ctrl + Enter でも保存される', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const textarea = openEditor(onUpdate)

    fireEvent.change(textarea, { target: { value: 'Windowsからの説明' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ description: 'Windowsからの説明' }))
  })

  it('修飾キーなしの Enter では保存せず、改行として扱う', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const textarea = openEditor(onUpdate)

    fireEvent.change(textarea, { target: { value: '1行目' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-inspector-description-input')).toBeInTheDocument()
  })
})

// 入力欄が伸びるほど保存ボタンが下に押し出されるので、編集中は操作列を
// パネルの下端に貼り付けて、スクロールしなくても押せるようにする。
describe('TaskInspector — 説明の編集中は保存ボタンが下端に貼り付く', () => {
  function openEditor() {
    renderInspector({
      task: makeTask({ description: '既存の説明' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn().mockResolvedValue(undefined),
    })
    fireEvent.click(screen.getByText('既存の説明'))
    return screen.getByRole('button', { name: '保存' })
  }

  it('保存・キャンセルの行が画面下端に貼り付く', () => {
    const row = openEditor().closest('div')

    expect(row?.className).toMatch(/\bsticky\b/)
    expect(row?.className).toMatch(/\bbottom-0\b/)
  })

  it('貼り付いた行の下は透けないよう背景が付いている', () => {
    const row = openEditor().closest('div')

    expect(row?.className).toMatch(/\bbg-gray-50\b/)
  })
})

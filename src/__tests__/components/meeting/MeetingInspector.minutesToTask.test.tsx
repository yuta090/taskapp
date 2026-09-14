import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import { MinutesConflictError } from '@/lib/minutes/errors'
import type { Meeting } from '@/types/database'

// #87: 議事録タブから、決まった作業(SPEC行)をワンクリックでタスク化する導線。
// バックエンド(parseMinutes/previewMinutes)は既存。ここでは UI 導線を検証する。

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

const MINUTES = [
  '# 定例MTG',
  '- [ ] SPEC(/spec/REVIEW_SPEC.md#a): レビュー観点を追記 (期限: 07/10, 担当: 田中)',
  '- [ ] SPEC(/spec/UI_RULES.md#b): インスペクタ幅を固定 <!--task:t-existing-->',
  '- [ ] SPEC(/spec/API_SPEC.md#c): エラーレスポンス整備',
].join('\n')

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    space_id: 's1',
    title: '定例MTG',
    status: 'ended',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-07-01T00:00:00Z',
    minutes_md: MINUTES,
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

const previewResult = {
  newSpecCount: 2,
  existingSpecCount: 1,
  newSpecs: [
    { lineNumber: 1, specPath: '/spec/REVIEW_SPEC.md#a', title: 'レビュー観点を追記' },
    { lineNumber: 3, specPath: '/spec/API_SPEC.md#c', title: 'エラーレスポンス整備' },
  ],
  existingSpecs: [
    { lineNumber: 2, specPath: '/spec/UI_RULES.md#b', title: 'インスペクタ幅を固定', taskId: 't-existing' },
  ],
}

const createResult = {
  createdCount: 2,
  createdTasks: [
    { taskId: 't1', title: 'レビュー観点を追記', specPath: '/spec/REVIEW_SPEC.md#a', dueDate: '2026-07-10', lineNumber: 1 },
    { taskId: 't2', title: 'エラーレスポンス整備', specPath: '/spec/API_SPEC.md#c', dueDate: null, lineNumber: 3 },
  ],
  updatedMinutes: MINUTES,
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function openMinutesTab() {
  fireEvent.click(screen.getByTestId('meeting-inspector-tab-taskify'))
}

describe('MeetingInspector 議事録→タスク化 (#87)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('議事録タブを開くとタスク化候補をプレビューし、新規SPEC行と件数を表示する', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue(previewResult)
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
        onCreateTasks={vi.fn()}
      />
    )
    openMinutesTab()

    await waitFor(() => {
      expect(onPreviewMinutes).toHaveBeenCalledWith('m1')
    })

    // 新規候補が2件表示される
    const candidates = await screen.findAllByTestId('minutes-task-candidate')
    expect(candidates).toHaveLength(2)
    expect(screen.getByText('レビュー観点を追記')).toBeTruthy()
    expect(screen.getByText('エラーレスポンス整備')).toBeTruthy()

    // タスク化ボタンに件数が出る
    const button = screen.getByTestId('minutes-taskify-button') as HTMLButtonElement
    expect(button.textContent).toContain('2')
    expect(button.disabled).toBe(false)
  })

  it('タスク化ボタン押下で onCreateTasks を呼び、作成結果を表示する', async () => {
    const onCreateTasks = vi.fn().mockResolvedValue(createResult)
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={vi.fn().mockResolvedValue(previewResult)}
        onCreateTasks={onCreateTasks}
      />
    )
    openMinutesTab()

    const button = await screen.findByTestId('minutes-taskify-button')
    fireEvent.click(button)

    await waitFor(() => {
      expect(onCreateTasks).toHaveBeenCalledWith('m1')
    })

    // 作成結果（2件）が表示され、候補ボタンは消える
    const result = await screen.findByTestId('minutes-task-result')
    expect(result.textContent).toContain('2')
    expect(screen.queryByTestId('minutes-taskify-button')).toBeNull()
  })

  it('新規候補が0件なら「候補なし」を表示しタスク化ボタンを出さない', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue({
      newSpecCount: 0,
      existingSpecCount: 1,
      newSpecs: [],
      existingSpecs: previewResult.existingSpecs,
    })
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
        onCreateTasks={vi.fn()}
      />
    )
    openMinutesTab()

    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalled())
    expect(await screen.findByTestId('minutes-task-empty')).toBeTruthy()
    expect(screen.queryByTestId('minutes-taskify-button')).toBeNull()
  })

  it('HIGH-N3: 一覧キャッシュ上は議事録が無くても(meeting.minutes_md=null)プレビューは呼ぶ（本文はページ側が用意する）', () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue({
      newSpecCount: 0,
      existingSpecCount: 0,
      newSpecs: [],
      existingSpecs: [],
    })
    render(
      <MeetingInspector
        meeting={makeMeeting({ minutes_md: null })}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
        onCreateTasks={vi.fn()}
      />
    )
    openMinutesTab()
    expect(onPreviewMinutes).toHaveBeenCalledWith('m1')
  })

  it('コールバック未提供でもタブは開けタスク化パネルは出さない（後方互換）', () => {
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} />
    )
    openMinutesTab()
    expect(screen.queryByTestId('minutes-task-panel')).toBeNull()
    expect(screen.queryByTestId('minutes-taskify-button')).toBeNull()
  })

  it('候補が0件のとき、書き方の案内を出す（非技術者向け）', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue({
      newSpecCount: 0,
      existingSpecCount: 0,
      newSpecs: [],
      existingSpecs: [],
    })
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onPreviewMinutes={onPreviewMinutes} />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalled())
    // まず「タスクにする行」という入口を案内する（書式を覚えなくてよい道）
    expect(await screen.findByText(/タスクにする行/)).toBeTruthy()
    // 字下げした行は候補に出ない、という落とし穴も伝える
    expect(await screen.findByText(/字下げした行は候補に出ません/)).toBeTruthy()
    // 「仕様書として扱う」を入れると決定事項のタスクになる、という違いも案内する
    expect(await screen.findByText(/決まるまで/)).toBeTruthy()
  })

  it('Wiki のページに紐づく候補は、ページ名を出し「決定事項」の印を付ける', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue({
      newSpecCount: 2,
      existingSpecCount: 0,
      newSpecs: [
        {
          lineNumber: 2,
          title: '玄関の向きを決める',
          specPath: null,
          wikiPageId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          wikiPageTitle: '家の間取り',
          isSpec: true,
        },
        {
          lineNumber: 4,
          title: '間取り案を3つ作る',
          specPath: null,
          wikiPageId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          wikiPageTitle: '検討メモ',
          isSpec: false,
        },
      ],
      existingSpecs: [],
    })
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onPreviewMinutes={onPreviewMinutes} />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalled())

    // ページ名が出る（開発用のパスではなく、人が読んで分かるほう）
    expect(await screen.findByText('家の間取り')).toBeTruthy()
    expect(screen.getByText('検討メモ')).toBeTruthy()
    // 「決定事項」の印は仕様書タグ付きの1件だけ
    expect(screen.getAllByTestId('minutes-task-candidate-decide')).toHaveLength(1)
  })

  // 回帰: 取得の最中に親が描き直すと（onPreviewMinutes は MeetingsPageClient で
  // その場で作られる無名関数なので、選択中の会議や参加者が変わるたびに別物になる）、
  // effect の後片付けで cancelled=true になり finally が飛ばされて「候補を確認中…」が
  // 永久に残っていた。previewKeyRef のガードで再取得も走らず、「もう一度確認」も
  // 読み込み中は出ないので、会議を切り替えるまで戻れなかった。
  it('取得中に親が描き直しても、候補の読み込みが終われば表示される', async () => {
    let resolvePreview: ((v: unknown) => void) | undefined
    const pending = new Promise((resolve) => {
      resolvePreview = resolve
    })
    // 1回目と2回目で「別の関数」を渡す（親の再描画で参照が変わる状況の再現）
    const first = vi.fn().mockReturnValue(pending)
    const second = vi.fn().mockReturnValue(pending)

    const meeting = makeMeeting()
    const { rerender } = render(
      <MeetingInspector meeting={meeting} onClose={vi.fn()} onPreviewMinutes={first} />
    )
    openMinutesTab()
    await waitFor(() => expect(first).toHaveBeenCalled())
    expect(screen.getByText('候補を確認中…')).toBeTruthy()

    // 取得の最中に親が描き直す
    rerender(<MeetingInspector meeting={meeting} onClose={vi.fn()} onPreviewMinutes={second} />)

    resolvePreview?.({
      newSpecCount: 1,
      existingSpecCount: 0,
      newSpecs: [
        {
          lineNumber: 2,
          title: '玄関の向きを決める',
          specPath: null,
          wikiPageId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          wikiPageTitle: '家の間取り',
          isSpec: true,
        },
      ],
      existingSpecs: [],
    })

    expect(await screen.findByText('玄関の向きを決める')).toBeTruthy()
    expect(screen.queryByText('候補を確認中…')).toBeNull()
    // 同じ会議なので取得は1回だけ（再描画で二重に走らせない）
    expect(second).not.toHaveBeenCalled()
  })

  it('M3: 「もう一度確認」でプレビューを取り直す', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue(previewResult)
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onPreviewMinutes={onPreviewMinutes} onCreateTasks={vi.fn()} />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('minutes-task-refresh'))
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(2))
  })

  it('LOW: 候補がまだ取れていない(プレビューが未解決の)ときは「ありません」を出さない', () => {
    // 解決しない Promise → previewLoading のまま。まだ preview===null のはず
    const onPreviewMinutes = vi.fn().mockReturnValue(new Promise(() => {}))
    render(
      <MeetingInspector
        meeting={makeMeeting({ minutes_md: null })}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
      />
    )
    openMinutesTab()
    expect(screen.queryByTestId('minutes-task-empty')).toBeNull()
  })

  it('LOW: 候補の取得に失敗したときは「ありません」を出さず、失敗の文言だけ出す', async () => {
    const onPreviewMinutes = vi.fn().mockRejectedValue(new Error('network'))
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onPreviewMinutes={onPreviewMinutes} />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalled())
    expect(await screen.findByText('タスク化候補の取得に失敗しました')).toBeTruthy()
    expect(screen.queryByTestId('minutes-task-empty')).toBeNull()
  })

  it('別の場所で更新されていて作れなかったときは、その理由の文を出す（「失敗しました」で終わらせない）', async () => {
    const message = 'この議事録は、別の場所で更新されています。最新を読み込んでからもう一度お試しください'
    const onCreateTasks = vi.fn().mockRejectedValue(new MinutesConflictError(message))
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={vi.fn().mockResolvedValue(previewResult)}
        onCreateTasks={onCreateTasks}
      />
    )
    openMinutesTab()

    fireEvent.click(await screen.findByTestId('minutes-taskify-button'))

    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByText('タスク化に失敗しました')).toBeNull()
    // 作成結果は出さない（1件も作られていない）
    expect(screen.queryByTestId('minutes-task-result')).toBeNull()
  })

  it('競合以外の失敗はこれまでどおり「タスク化に失敗しました」と出す', async () => {
    const onCreateTasks = vi.fn().mockRejectedValue(new Error('network'))
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={vi.fn().mockResolvedValue(previewResult)}
        onCreateTasks={onCreateTasks}
      />
    )
    openMinutesTab()

    fireEvent.click(await screen.findByTestId('minutes-taskify-button'))

    expect(await screen.findByText('タスク化に失敗しました')).toBeTruthy()
  })

  it('LOW: タスク化を1回した後も「もう一度確認」を出し、押すとプレビューを取り直す', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue(previewResult)
    const onCreateTasks = vi.fn().mockResolvedValue(createResult)
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
        onCreateTasks={onCreateTasks}
      />
    )
    openMinutesTab()
    const button = await screen.findByTestId('minutes-taskify-button')
    fireEvent.click(button)
    await screen.findByTestId('minutes-task-result')

    const refreshButton = screen.getByTestId('minutes-task-refresh')
    fireEvent.click(refreshButton)

    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('minutes-task-result')).toBeNull()
  })
})

/**
 * 候補は「タブを開くたび」に取り直す。
 *
 * 以前は会議ごとに一度しか取りに行かなかった（previewKeyRef のガード）。そのため
 * 議事録に行を足してもタブを開き直しても候補が古いままで、「もう一度確認」に気づいた
 * 人だけが最新を見られる状態だった（ユーザー報告）。
 *
 * 元々このガードは「取得中に親が描き直されると読み込みが止まらなくなる」対策だったが、
 * それは ref に逃がして別に塞いである（上の回帰テスト）。絞る理由はもう無い。
 */
describe('MeetingInspector タスク化の候補の取り直し', () => {
  it('タブを開き直すたびに候補を取り直す', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue(previewResult)
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onPreviewMinutes={onPreviewMinutes} />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(1))

    // ほかのタブへ移って戻る
    fireEvent.click(screen.getByTestId('meeting-inspector-tab-info'))
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(2))
  })

  it('タスク化したあとにタブを開き直すと、作成済みが反映された候補を取り直す', async () => {
    const onPreviewMinutes = vi.fn().mockResolvedValue(previewResult)
    const onCreateTasks = vi.fn().mockResolvedValue(createResult)
    render(
      <MeetingInspector
        meeting={makeMeeting()}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
        onCreateTasks={onCreateTasks}
      />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByTestId('minutes-taskify-button'))
    await waitFor(() => expect(onCreateTasks).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('meeting-inspector-tab-info'))
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(2))
  })

  it('取得の途中でタブを出入りしても、先に投げた古い結果で上書きしない', async () => {
    // 1本目の応答が遅れている間にタブを離れて戻ると2本目が走る。応答が前後したとき、
    // 古い本文の候補が後から表示されると、直そうとしている症状がそのまま再発する
    const first = deferred<typeof previewResult>()
    const second = deferred<typeof previewResult>()
    const onPreviewMinutes = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onPreviewMinutes={onPreviewMinutes} />
    )
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(1))

    // 1本目が返る前に離れて戻る
    fireEvent.click(screen.getByTestId('meeting-inspector-tab-info'))
    openMinutesTab()
    await waitFor(() => expect(onPreviewMinutes).toHaveBeenCalledTimes(2))

    // 2本目（最新）が先に返り、そのあとに1本目（古い）が返る
    await act(async () => {
      second.resolve({
        ...previewResult,
        newSpecCount: 1,
        newSpecs: [{ lineNumber: 9, specPath: '/spec/NEW.md#z', title: '新しく足した行' }],
      })
      await second.promise
    })
    await act(async () => {
      first.resolve(previewResult)
      await first.promise
    })

    const candidates = await screen.findAllByTestId('minutes-task-candidate')
    expect(candidates).toHaveLength(1)
    expect(screen.getByText('新しく足した行')).toBeTruthy()
    expect(screen.queryByText('レビュー観点を追記')).toBeNull()
  })
})

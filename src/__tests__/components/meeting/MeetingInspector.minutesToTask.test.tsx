import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
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
      expect(onPreviewMinutes).toHaveBeenCalledWith('m1', MINUTES)
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
      expect(onCreateTasks).toHaveBeenCalledWith('m1', MINUTES)
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

  it('議事録が無い会議ではプレビューを呼ばない', () => {
    const onPreviewMinutes = vi.fn()
    render(
      <MeetingInspector
        meeting={makeMeeting({ minutes_md: null })}
        onClose={vi.fn()}
        onPreviewMinutes={onPreviewMinutes}
        onCreateTasks={vi.fn()}
      />
    )
    openMinutesTab()
    expect(onPreviewMinutes).not.toHaveBeenCalled()
  })

  it('コールバック未提供でもタブは開けタスク化パネルは出さない（後方互換）', () => {
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} />
    )
    openMinutesTab()
    expect(screen.queryByTestId('minutes-task-panel')).toBeNull()
    expect(screen.queryByTestId('minutes-taskify-button')).toBeNull()
  })

  it('候補が0件のとき、SPEC行の書き方の案内を出す（非技術者向け）', async () => {
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
    expect(await screen.findByText(/SPEC\(資料の場所\): やること/)).toBeTruthy()
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

  it('LOW: 議事録が無く候補がまだ取れていないときは「ありません」を出さない', () => {
    const onPreviewMinutes = vi.fn()
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

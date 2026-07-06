import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import type { Meeting, MeetingParticipant } from '@/types/database'

// C1: 参加者欄が user_id (UUID) をそのまま描画していたバグの回帰テスト。
// C2: 会議削除フロー(確認ダイアログ→削除→onDelete呼び出し、日程調整紐づき時の失敗ハンドリング)。
// C3: 議事録なしの空状態に次の行動が分かる案内を出す。

const mockMembers = [
  { id: 'u1', displayName: '田中太郎', avatarUrl: null, role: 'client' },
  { id: 'u2', displayName: '鈴木花子', avatarUrl: null, role: 'editor' },
]

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: mockMembers,
    clientMembers: mockMembers.filter((m) => m.role === 'client'),
    internalMembers: mockMembers.filter((m) => m.role !== 'client'),
    loading: false,
    error: null,
    getMemberName: (id: string) => mockMembers.find((m) => m.id === id)?.displayName ?? id,
  }),
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'o1',
    space_id: 's1',
    title: '定例MTG',
    status: 'planned',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    notes: null,
    minutes_md: null,
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

function makeParticipant(overrides: Partial<MeetingParticipant>): MeetingParticipant {
  return {
    id: 'p1',
    org_id: 'o1',
    space_id: 's1',
    meeting_id: 'm1',
    user_id: 'u1',
    side: 'client',
    created_at: '2026-07-01T00:00:00',
    ...overrides,
  } as MeetingParticipant
}

describe('MeetingInspector 参加者の名前解決 (C1)', () => {
  it('参加者一覧に表示名を表示し、UUIDを描画しない', () => {
    const participants = [
      makeParticipant({ id: 'p1', user_id: 'u1', side: 'client' }),
      makeParticipant({ id: 'p2', user_id: 'u2', side: 'internal' }),
    ]
    render(
      <MeetingInspector meeting={makeMeeting()} participants={participants} onClose={vi.fn()} />
    )

    expect(screen.getByText('田中太郎')).toBeTruthy()
    expect(screen.getByText('鈴木花子')).toBeTruthy()
    expect(screen.queryByText('u1')).toBeNull()
    expect(screen.queryByText('u2')).toBeNull()
  })

  it('メンバー情報が解決できない参加者はUUIDを出さずフォールバック表示する', () => {
    const participants = [makeParticipant({ id: 'p3', user_id: 'unknown-user-id', side: 'client' })]
    render(
      <MeetingInspector meeting={makeMeeting()} participants={participants} onClose={vi.fn()} />
    )

    expect(screen.queryByText('unknown-user-id')).toBeNull()
    expect(screen.queryByText(/unknown-user-id/)).toBeNull()
  })
})

describe('MeetingInspector 会議削除 (C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('削除ボタン→確認ダイアログで確認すると onDelete が呼ばれ、閉じられる', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <MeetingInspector meeting={makeMeeting()} onClose={onClose} onDelete={onDelete} />
    )

    fireEvent.click(screen.getByTestId('meeting-inspector-delete'))

    // 確認ダイアログが出る
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('確認ダイアログでキャンセルすると onDelete は呼ばれない', async () => {
    const onDelete = vi.fn()
    render(<MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} onDelete={onDelete} />)

    fireEvent.click(screen.getByTestId('meeting-inspector-delete'))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('onDelete が失敗(日程調整に紐づく等)しても onClose は呼ばれない', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('この会議は日程調整に紐づいているため削除できません'))
    const onClose = vi.fn()
    render(<MeetingInspector meeting={makeMeeting()} onClose={onClose} onDelete={onDelete} />)

    fireEvent.click(screen.getByTestId('meeting-inspector-delete'))
    fireEvent.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('onDelete が渡されない場合は削除ボタンを表示しない', () => {
    render(<MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} />)
    expect(screen.queryByTestId('meeting-inspector-delete')).toBeNull()
  })
})

describe('MeetingInspector 議事録なしの空状態 (C3)', () => {
  it('次の行動が分かる案内文を表示する', () => {
    render(<MeetingInspector meeting={makeMeeting({ minutes_md: null })} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('meeting-inspector-tab-minutes'))
    expect(screen.getByText('議事録はまだありません。会議終了後にここに表示されます。')).toBeTruthy()
  })
})

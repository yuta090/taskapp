import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import { MinutesConflictError } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// 議事録の文書ビュー。中央の広い領域に Wiki と同じ書き味で本文を出し、自動保存する。
// 保存の歯止め（開いただけで保存0回・空本文で止める・競合の帯）が本体。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

let capturedOnChange: ((md: string) => void) | undefined
let lastEditorProps: { minutesMd: string; editable: boolean } | null = null

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { minutesMd: string; editable: boolean; onChange?: (md: string) => void }) => {
    capturedOnChange = props.onChange
    lastEditorProps = { minutesMd: props.minutesMd, editable: props.editable }
    return <div data-testid="minutes-editor" data-editable={String(props.editable)} />
  },
}))

const mockWriteText = vi.fn().mockResolvedValue(undefined)
Object.assign(navigator, { clipboard: { writeText: mockWriteText } })

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    title: '定例MTG',
    status: 'planned',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00.111111+00',
    notes: null,
    minutes_md: '# 定例MTG\n\n本文',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

function setup(overrides: Partial<Meeting> = {}, extraProps: Record<string, unknown> = {}) {
  const meeting = makeMeeting(overrides)
  const updateMinutes = vi.fn().mockResolvedValue('2026-09-01T00:00:01.222222+00')
  const fetchMeetingDetail = vi.fn().mockResolvedValue(meeting)
  const onBack = vi.fn()
  const onOpenInfo = vi.fn()
  const ref = createRef<MinutesDocumentViewHandle>()

  const utils = render(
    <MinutesDocumentView
      ref={ref}
      orgId="org1"
      spaceId="space1"
      meeting={meeting}
      canEdit
      onBack={onBack}
      onOpenInfo={onOpenInfo}
      updateMinutes={updateMinutes}
      fetchMeetingDetail={fetchMeetingDetail}
      {...extraProps}
    />
  )

  return { meeting, updateMinutes, fetchMeetingDetail, onBack, onOpenInfo, ref, ...utils }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  capturedOnChange = undefined
  lastEditorProps = null
  mockWriteText.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MinutesDocumentView 開いただけでは保存しない', () => {
  it('マウント直後に onChange が正規化済みの同じ内容で呼ばれても保存は走らない', async () => {
    const { updateMinutes } = setup()
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()

    // BlockNote が初期表示直後に normalize 済みの同一内容で onChange を呼ぶケースを模す
    act(() => capturedOnChange?.('# 定例MTG\n\n本文'))

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(updateMinutes).not.toHaveBeenCalled()
  })
})

describe('MinutesDocumentView 自動保存', () => {
  it('編集後、デバウンスを経て正規化済みMarkdownで保存する', async () => {
    const { updateMinutes, meeting } = setup()

    act(() => capturedOnChange?.('# 定例MTG\n\n編集後の本文'))

    // デバウンス中はまだ呼ばれない
    expect(updateMinutes).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    expect(updateMinutes).toHaveBeenCalledWith(
      'm1',
      '# 定例MTG\n\n編集後の本文',
      meeting.updated_at
    )
  })

  it('保存中→保存済みの表示が出る', async () => {
    const { } = setup()
    act(() => capturedOnChange?.('新しい本文'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByText('保存済み')).toBeInTheDocument()
  })
})

describe('MinutesDocumentView 空本文', () => {
  it('本文が空になったら保存せず注意文を出す', async () => {
    const { updateMinutes } = setup()

    act(() => capturedOnChange?.('   '))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(updateMinutes).not.toHaveBeenCalled()
    expect(screen.getByText('本文が空です。保存されていません')).toBeInTheDocument()
  })
})

describe('MinutesDocumentView 競合', () => {
  it('保存が競合したら帯を出し、以後の自動保存を止める', async () => {
    const { updateMinutes } = setup()
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    expect(
      screen.getByText(
        'この議事録は、開いたあとに別の場所（AI・コマンド・ほかの人）で更新されました。この画面で書いた内容はまだ保存されていません。'
      )
    ).toBeInTheDocument()

    // 競合後にさらに編集しても自動保存は走らない
    updateMinutes.mockClear()
    act(() => capturedOnChange?.('さらに編集した本文'))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(updateMinutes).not.toHaveBeenCalled()
  })

  it('「書きかけをコピー」で今の本文をクリップボードへコピーする', async () => {
    const { updateMinutes } = setup()
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByText('書きかけをコピー')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('書きかけをコピー'))
    })
    expect(mockWriteText).toHaveBeenCalledWith('編集した本文')
  })

  it('「最新を読み込む」で詳細を取り直し、帯を閉じてエディタを作り直す', async () => {
    const fresh = makeMeeting({ minutes_md: 'サーバー側の最新本文', updated_at: '2026-09-01T00:00:02.333333+00' })
    const { updateMinutes, fetchMeetingDetail } = setup()
    fetchMeetingDetail.mockResolvedValue(fresh)
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByText('最新を読み込む')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('最新を読み込む'))
    })

    expect(fetchMeetingDetail).toHaveBeenCalledWith('m1')
    expect(
      screen.queryByText(
        'この議事録は、開いたあとに別の場所（AI・コマンド・ほかの人）で更新されました。この画面で書いた内容はまだ保存されていません。'
      )
    ).not.toBeInTheDocument()
    expect(lastEditorProps?.minutesMd).toBe('サーバー側の最新本文')

    // 作り直した後の編集は、新しい基準(updated_at)で保存する
    updateMinutes.mockClear()
    updateMinutes.mockResolvedValue('2026-09-01T00:00:03.444444+00')
    act(() => capturedOnChange?.('新しい基準からの編集'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(updateMinutes).toHaveBeenCalledWith('m1', '新しい基準からの編集', '2026-09-01T00:00:02.333333+00')
  })
})

describe('MinutesDocumentView 権限', () => {
  it('書けない人は読み取り専用', () => {
    setup({}, { canEdit: false })
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'false')
  })

  it('予定(planned)の会議でも書ける人は書ける（status では決めない）', () => {
    setup({ status: 'planned' }, { canEdit: true })
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'true')
  })
})

describe('MinutesDocumentView 読み込み前', () => {
  it('詳細(minutes_md)を読み込むまでエディタを出さない', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setup({ minutes_md: undefined as any })
    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument()
  })
})

describe('MinutesDocumentView タスク化のための保留中保存の即時反映', () => {
  it('flushPendingSave: 保留中の保存があれば即座に流し、保存後の本文を返す', async () => {
    const { updateMinutes, ref, meeting } = setup()
    act(() => capturedOnChange?.('保存前の本文'))

    let flushed = ''
    await act(async () => {
      flushed = await ref.current!.flushPendingSave()
    })

    expect(updateMinutes).toHaveBeenCalledWith('m1', '保存前の本文', meeting.updated_at)
    expect(flushed).toBe('保存前の本文')
  })

  it('flushPendingSave: 保留中の保存が無ければ何もせず今の本文を返す', async () => {
    const { updateMinutes, ref } = setup()

    let flushed = ''
    await act(async () => {
      flushed = await ref.current!.flushPendingSave()
    })

    expect(updateMinutes).not.toHaveBeenCalled()
    expect(flushed).toBe('# 定例MTG\n\n本文')
  })
})

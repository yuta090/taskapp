import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import type { Meeting } from '@/types/database'

// 議事録の「全画面」表示（Wiki の WikiPageClient.tsx と同じ見た目・testid規則）。
// useShellFullscreen は AppShell の中でしか呼べないため、この部品自身は呼ばず、
// fullscreen/onToggleFullscreen を任意の props として受け取るだけ（呼び出し側の
// MeetingsPageClient が useShellFullscreen を呼んで橋渡しする）。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: 'u-self', email: 'me@example.com', user_metadata: { name: '自分' } },
    loading: false,
    error: null,
  }),
}))

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({ others: [], setEditing: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: () => <div data-testid="minutes-editor" />,
}))

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

function setup(extraProps: Record<string, unknown> = {}) {
  const meeting = makeMeeting()
  const updateMinutes = vi.fn().mockResolvedValue({ minutesMd: '本文', updatedAt: 'U1' })
  const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting())
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
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MinutesDocumentView 全画面表示（props 経由）', () => {
  it('fullscreen/onToggleFullscreen の両方が無ければ全画面ボタンを出さない', async () => {
    setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByTestId('minutes-fullscreen-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('minutes-fullscreen-close')).not.toBeInTheDocument()
  })

  it('fullscreen だけ渡されて onToggleFullscreen が無ければボタンを出さない', async () => {
    setup({ fullscreen: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByTestId('minutes-fullscreen-toggle')).not.toBeInTheDocument()
  })

  it('両方揃っていれば全画面ボタンを出し、押すと onToggleFullscreen を呼ぶ', async () => {
    const onToggleFullscreen = vi.fn()
    setup({ fullscreen: false, onToggleFullscreen })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const toggle = screen.getByTestId('minutes-fullscreen-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('fullscreen=true のときは「全画面を閉じる」ボタンに切り替わり、戻る/情報ボタンを隠す', async () => {
    const onToggleFullscreen = vi.fn()
    setup({ fullscreen: true, onToggleFullscreen })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('minutes-fullscreen-close')).toBeInTheDocument()
    expect(screen.queryByTestId('minutes-fullscreen-toggle')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('会議一覧へ戻る')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('会議情報')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('minutes-fullscreen-close'))
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('fullscreen=true のとき編集領域が広い(max-w-6xl)クラスになる', async () => {
    setup({ fullscreen: true, onToggleFullscreen: vi.fn() })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('minutes-editor-region')).toHaveClass('max-w-6xl')
    expect(screen.getByTestId('minutes-editor-region')).not.toHaveClass('max-w-4xl')
  })

  it('fullscreen=false のとき編集領域は通常幅(max-w-4xl)のまま', async () => {
    setup({ fullscreen: false, onToggleFullscreen: vi.fn() })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('minutes-editor-region')).toHaveClass('max-w-4xl')
    expect(screen.getByTestId('minutes-editor-region')).not.toHaveClass('max-w-6xl')
  })
})

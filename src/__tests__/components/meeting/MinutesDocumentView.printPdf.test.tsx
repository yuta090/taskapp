import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import type { Meeting } from '@/types/database'

// 議事録を PDF にするとき、紙に載せるのは会議名・日時と本文だけにする。
// 画面の枠（左メニュー・右の会議情報・ボタン類・知らせの帯）が一緒に刷られないよう、
// Wiki(WikiPageClient.tsx)と同じ2つの目印を置き、globals.css の @media print がそれを見る。
//   data-print-root … このかたまりだけを紙に載せる
//   data-print-hide … かたまりの中でも紙には載せない（押すためのもの・知らせの帯）
// 印刷の指定そのもの（globals.css 側）は WikiPageClient.printPdf.test.tsx で検査している。

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

const mockOthers = vi.hoisted(() => ({
  value: [] as Array<{ userId: string; name: string; editing: boolean; joinedAt: number; collab: boolean }>,
}))
vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({ others: mockOthers.value, setEditing: vi.fn() }),
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
    held_at: '2026-09-18T10:00:00+09:00',
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

function setup(extraProps: Record<string, unknown> = {}, meetingOverrides: Partial<Meeting> = {}) {
  const meeting = makeMeeting(meetingOverrides)
  const ref = createRef<MinutesDocumentViewHandle>()
  const utils = render(
    <MinutesDocumentView
      ref={ref}
      orgId="org1"
      spaceId="space1"
      meeting={meeting}
      canEdit
      onBack={vi.fn()}
      onOpenInfo={vi.fn()}
      updateMinutes={vi.fn().mockResolvedValue({ minutesMd: '本文', updatedAt: 'U1' })}
      fetchMeetingDetail={vi.fn().mockResolvedValue(makeMeeting(meetingOverrides))}
      fullscreen={false}
      onToggleFullscreen={vi.fn()}
      {...extraProps}
    />
  )
  return { meeting, ref, ...utils }
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOthers.value = []
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MinutesDocumentView — PDFで保存したときに紙へ載る範囲', () => {
  it('紙に載せるかたまりに、会議名・日時と本文が入っている', async () => {
    setup()
    await flush()

    const printRoot = document.querySelector('[data-print-root]')
    expect(printRoot).not.toBeNull()
    expect(printRoot).toContainElement(screen.getByRole('heading', { name: '定例MTG' }))
    expect(printRoot).toContainElement(screen.getByTestId('minutes-editor'))
  })

  it('ヘッダーのボタン類（戻る・全画面・会議情報）は紙に載せない印が付いている', async () => {
    setup()
    await flush()

    expect(screen.getByLabelText('会議一覧へ戻る').closest('[data-print-hide]')).not.toBeNull()
    expect(screen.getByTestId('minutes-fullscreen-toggle').closest('[data-print-hide]')).not.toBeNull()
    expect(screen.getByLabelText('会議情報').closest('[data-print-hide]')).not.toBeNull()
  })

  it('ほかの人が書いている知らせの帯は紙に載せない', async () => {
    mockOthers.value = [{ userId: 'u2', name: '田中', editing: true, joinedAt: 1, collab: true }]
    setup()
    await flush()

    expect(screen.getByTestId('minutes-presence-banner').closest('[data-print-hide]')).not.toBeNull()
  })

  it('競合の帯（あなたの書きかけが保存されていない知らせ）は紙に載せない', async () => {
    const { ref } = setup()
    await flush()

    act(() => {
      ref.current?.markConflict()
    })

    expect(screen.getByTestId('minutes-conflict-banner').closest('[data-print-hide]')).not.toBeNull()
  })

  it('本文が空のときの書き出しの案内は紙に載せない', async () => {
    setup({}, { minutes_md: '' })
    await flush()

    const guide = screen.getByText(/ここに議事録を書きます/)
    expect(guide.closest('[data-print-hide]')).not.toBeNull()
  })
})

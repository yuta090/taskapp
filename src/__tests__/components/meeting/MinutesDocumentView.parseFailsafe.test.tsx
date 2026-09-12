import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MinutesDocumentView } from '@/components/meeting/MinutesDocumentView'
import type { Meeting } from '@/types/database'

// M2: 変換(parseMinutesMarkdown→serializeMinutesBlocks)が例外を出したときの守りを、
// 親（文書ビュー）でも try/catch する。失敗したら読み取り専用にして、保存を止める。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/minutes/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/minutes/markdown')>()
  return {
    ...actual,
    parseMinutesMarkdown: () => {
      throw new Error('boom')
    },
  }
})

let capturedOnChange: ((md: string) => void) | undefined
let lastEditable: boolean | undefined

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { editable: boolean; onChange?: (md: string) => void }) => {
    capturedOnChange = props.onChange
    lastEditable = props.editable
    return <div data-testid="minutes-editor" data-editable={String(props.editable)} />
  },
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    title: '定例MTG',
    status: 'ended',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00.111111+00',
    notes: null,
    minutes_md: '壊れた本文',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  capturedOnChange = undefined
  lastEditable = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('M2: 変換が例外を出しても画面を壊さず読み取り専用にする（文書ビュー側の守り）', () => {
  it('parseMinutesMarkdown が例外を投げても表示は壊れず、編集可能でも読み取り専用にする', async () => {
    const updateMinutes = vi.fn()
    const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting())

    expect(() =>
      render(
        <MinutesDocumentView
          orgId="org1"
          spaceId="space1"
          meeting={makeMeeting()}
          canEdit
          onBack={vi.fn()}
          onOpenInfo={vi.fn()}
          updateMinutes={updateMinutes}
          fetchMeetingDetail={fetchMeetingDetail}
        />
      )
    ).not.toThrow()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()
    expect(lastEditable).toBe(false)

    // onChange が万一呼ばれても保存しない
    act(() => capturedOnChange?.('何か書けたことにする'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(updateMinutes).not.toHaveBeenCalled()
  })
})

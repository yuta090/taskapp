import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import type { Meeting } from '@/types/database'

// 右の会議情報パネルから議事録を PDF にする導線（Wiki のページ情報パネルと同じ形）。
// 作りはブラウザの印刷を借りるだけで、押すと印刷の画面が開く（保存先で PDF を選ぶ）。
// 「紙に何を載せるか」は globals.css の @media print 側にあり、そちらは
// MinutesDocumentView.printPdf.test.tsx / WikiPageClient.printPdf.test.tsx で検査する。

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [] }),
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
    updated_at: '2026-09-01T00:00:00',
    notes: null,
    minutes_md: '# 定例MTG',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

const printMock = vi.fn()

beforeEach(() => {
  printMock.mockReset()
  // jsdom の window.print は呼ぶと「未実装」で落ちるので差し替える
  Object.defineProperty(window, 'print', { value: printMock, writable: true, configurable: true })
})

describe('MeetingInspector — PDFで保存', () => {
  it('会議情報パネルに「PDFで保存」ボタンが出る', () => {
    render(<MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'PDFで保存' })).toBeInTheDocument()
  })

  it('押すと印刷の画面が開く', () => {
    render(<MeetingInspector meeting={makeMeeting()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'PDFで保存' }))

    expect(printMock).toHaveBeenCalledTimes(1)
  })

  it('会議が終わったあとでも出る。終わった会議こそ控えを配る', () => {
    render(<MeetingInspector meeting={makeMeeting({ status: 'ended' })} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'PDFで保存' })).toBeInTheDocument()
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeetingCreateSheet } from '@/components/meeting/MeetingCreateSheet'

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    clientMembers: [{ id: 'c1', name: '相手先の人' }],
    internalMembers: [{ id: 'i1', name: '社内の人' }],
    loading: false,
    error: null,
  }),
}))

const SPACE_ID = 'space-1'

function setup(props: Partial<React.ComponentProps<typeof MeetingCreateSheet>> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  render(
    <MeetingCreateSheet spaceId={SPACE_ID} isOpen onClose={onClose} onSubmit={onSubmit} {...props} />
  )
  return { onSubmit, onClose }
}

describe('会議の新規作成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('いつもの形では、日時と参加者も出す', () => {
    setup()
    expect(screen.getByTestId('meeting-create-held-at')).toBeInTheDocument()
    expect(screen.getByText('外部参加者')).toBeInTheDocument()
  })

  describe('記録だけの議事録', () => {
    it('聞くのはタイトルだけにする', () => {
      setup({ minutesOnly: true })
      expect(screen.getByTestId('meeting-create-title')).toBeInTheDocument()
      expect(screen.queryByTestId('meeting-create-held-at')).not.toBeInTheDocument()
      expect(screen.queryByText('外部参加者')).not.toBeInTheDocument()
    })

    it('あとから足せることを画面で伝える', () => {
      setup({ minutesOnly: true })
      expect(screen.getByTestId('meeting-create-minutes-only-note')).toHaveTextContent('あとから')
    })

    it('見出しを「記録だけの議事録」にする', () => {
      setup({ minutesOnly: true })
      expect(screen.getByRole('heading', { name: '記録だけの議事録' })).toBeInTheDocument()
    })

    it('タイトルだけで作れる（参加者は空のまま）', async () => {
      const { onSubmit } = setup({ minutesOnly: true })
      fireEvent.change(screen.getByTestId('meeting-create-title'), { target: { value: '9/15 打ち合わせ' } })
      fireEvent.click(screen.getByTestId('meeting-create-submit'))
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        title: '9/15 打ち合わせ',
        clientParticipantIds: [],
        internalParticipantIds: [],
      })
    })
  })
})

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MinutesWikiLinkPicker } from '@/components/meeting/MinutesWikiLinkPicker'

const mockPages = [
  { id: 'w1', title: 'キックオフ議事録' },
  { id: 'w2', title: '仕様メモ' },
]

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: mockPages, loading: false }),
}))

describe('MinutesWikiLinkPicker', () => {
  it('Wiki ページの一覧を表示し、押すと onSelect にページを渡す', () => {
    const onSelect = vi.fn()
    render(<MinutesWikiLinkPicker orgId="o1" spaceId="s1" onSelect={onSelect} />)

    expect(screen.getByText('キックオフ議事録')).toBeTruthy()
    expect(screen.getByText('仕様メモ')).toBeTruthy()

    fireEvent.click(screen.getByText('仕様メモ'))
    expect(onSelect).toHaveBeenCalledWith({ id: 'w2', title: '仕様メモ' })
  })

  it('名前で絞り込める', () => {
    render(<MinutesWikiLinkPicker orgId="o1" spaceId="s1" onSelect={vi.fn()} />)
    fireEvent.change(screen.getByTestId('minutes-wiki-link-picker-input'), {
      target: { value: 'キックオフ' },
    })
    expect(screen.getByText('キックオフ議事録')).toBeTruthy()
    expect(screen.queryByText('仕様メモ')).toBeNull()
  })
})

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionCard } from '@/components/portal/ui/ActionCard'

/**
 * `readOnly` (portal preview mode, #99 ストリームC): hides the hover-reveal
 * 承認/修正依頼 buttons entirely, without touching onViewDetail (a read).
 */
describe('ActionCard readOnly', () => {
  it('hides 承認/修正依頼 buttons when readOnly is set', () => {
    render(
      <ActionCard
        id="task-1"
        title="ロゴのご確認"
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
        readOnly
      />
    )

    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修正依頼' })).not.toBeInTheDocument()
  })

  it('shows 承認/修正依頼 buttons by default (unaffected when readOnly is not set)', () => {
    render(
      <ActionCard
        id="task-1"
        title="ロゴのご確認"
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
      />
    )

    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修正依頼' })).toBeInTheDocument()
  })
})

/**
 * B4: with the comment input open, キャンセル/承認/送信 sat side by side,
 * making it easy to hit 承認 by mistake while writing a change request.
 */
describe('ActionCard — approve hidden while comment input is open (B4)', () => {
  it('hides 承認 once the comment input opens, keeping only キャンセル and 修正依頼を送信', () => {
    render(
      <ActionCard
        id="task-1"
        title="ロゴのご確認"
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '修正依頼' }))

    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修正依頼を送信' })).toBeInTheDocument()
  })
})

/**
 * B10: the spec badge said "SPEC" in English here, but "仕様" everywhere
 * else in the portal (PortalTaskInspector, PortalAllTasksClient).
 */
describe('ActionCard — SPEC badge wording (B10)', () => {
  it('shows 仕様 instead of the English "SPEC" for spec-type tasks', () => {
    render(<ActionCard id="task-1" title="仕様書のご確認" type="spec" />)

    expect(screen.getByText('仕様')).toBeInTheDocument()
    expect(screen.queryByText('SPEC')).not.toBeInTheDocument()
  })
})

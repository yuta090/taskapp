import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

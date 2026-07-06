import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorFallback } from '@/components/shared/ErrorFallback'

/**
 * B7: the "ホームに戻る" link always pointed at "/", the marketing LP, even
 * from a portal error page. Allow callers to override the back destination.
 */
describe('ErrorFallback — configurable back link (B7)', () => {
  it('defaults to the marketing home page when no backHref is provided', () => {
    render(<ErrorFallback error={new Error('boom')} reset={() => {}} />)

    expect(screen.getByRole('link', { name: /ホームに戻る/ })).toHaveAttribute('href', '/')
  })

  it('uses the provided backHref and backLabel', () => {
    render(
      <ErrorFallback
        error={new Error('boom')}
        reset={() => {}}
        backHref="/portal"
        backLabel="ポータルに戻る"
      />
    )

    expect(screen.getByRole('link', { name: /ポータルに戻る/ })).toHaveAttribute('href', '/portal')
  })
})

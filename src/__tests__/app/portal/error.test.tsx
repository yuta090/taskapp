import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PortalError from '@/app/portal/error'

/**
 * B7: the portal error boundary should send clients back into the portal,
 * not the marketing home page.
 */
describe('PortalError (B7)', () => {
  it('links back to /portal instead of the marketing home', () => {
    render(<PortalError error={new Error('boom')} reset={() => {}} />)

    expect(screen.getByRole('link', { name: /ポータルに戻る/ })).toHaveAttribute('href', '/portal')
  })
})

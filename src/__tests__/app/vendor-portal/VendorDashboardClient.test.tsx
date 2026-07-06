import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VendorDashboardClient } from '@/app/vendor-portal/VendorDashboardClient'

/**
 * B9: "ボールが自社にあるタスク" leaks an internal-only term ("ball
 * ownership") into the vendor-facing portal.
 */
describe('VendorDashboardClient — no internal jargon (B9)', () => {
  it('describes vendor-owned tasks without using the internal "ボール" term', () => {
    render(
      <VendorDashboardClient
        spaceId="space-1"
        spaceName="テストプロジェクト"
        orgId="org-1"
        stats={{ vendorBall: 3, agencyBall: 1, total: 10 }}
      />
    )

    expect(screen.getByText('自社の対応待ちのタスク')).toBeInTheDocument()
    expect(screen.queryByText(/ボール/)).not.toBeInTheDocument()
  })
})

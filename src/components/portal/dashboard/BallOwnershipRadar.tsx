'use client'

import { SplitPill } from '../ui'

interface BallOwnershipRadarProps {
  clientCount: number
  teamCount: number
  className?: string
}

export function BallOwnershipRadar({ clientCount, teamCount, className = '' }: BallOwnershipRadarProps) {
  const total = clientCount + teamCount

  if (total === 0) {
    return null
  }

  // Determine which side is "active" (has more work)
  const activeLeft = clientCount > 0

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <SplitPill
        leftLabel="あなた"
        leftValue={clientCount}
        rightLabel="先方"
        rightValue={teamCount}
        activeLeft={activeLeft}
      />
    </div>
  )
}

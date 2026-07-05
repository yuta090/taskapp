import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// DESIGN_SYSTEM.md 3.2 Font Weight: 使用可能ウェイトは
// font-normal(400) / font-medium(500) / font-semibold(600) の3段階のみ。
// font-bold(700)・font-black(900) は規格外（日本語グリフでは特に潰れて見える）。

const SRC = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

const FORBIDDEN_WEIGHTS = /font-bold|font-extrabold|font-black/

const PORTAL_DASHBOARD_FILES = [
  'app/portal/PortalDashboardClient.tsx',
  'components/portal/dashboard/MetricCard.tsx',
  'components/portal/dashboard/NextDeliveryMetric.tsx',
  'components/portal/dashboard/ProgressSection.tsx',
  'components/portal/dashboard/BentoCard.tsx',
  'components/portal/dashboard/MilestoneTimeline.tsx',
  'components/portal/dashboard/ActionSection.tsx',
  'components/portal/dashboard/HealthSection.tsx',
  'components/portal/dashboard/ApprovalHistory.tsx',
  'components/portal/dashboard/ActivityFeed.tsx',
  'components/portal/dashboard/BallOwnershipRadar.tsx',
]

describe('design tokens: フォントウェイト階層（ポータルダッシュボード）', () => {
  it.each(PORTAL_DASHBOARD_FILES)(
    '%s は font-bold / font-black を使わない（normal/medium/semibold の3段階）',
    (rel) => {
      const src = read(rel)
      const match = src.match(FORBIDDEN_WEIGHTS)
      expect(match, `規格外ウェイト "${match?.[0]}" が残っています`).toBeNull()
    },
  )
})

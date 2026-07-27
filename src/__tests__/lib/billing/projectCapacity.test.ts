import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * プロジェクト(spaces)数の容量判定。
 *
 * 課金モデル(2026-07-26 決定・案A): 値段の階段は Free/Pro/Enterprise の1本のまま、
 * 各プランに「相手先グループ数」と「プロジェクト数」の2枠を置き、足りない方でtierが上がる。
 * ここは後者の数え役。執行原則は相手先グループ枠と同じ＝**新規作成のみ拒否・既存は絶対に切らない**。
 *
 * 数え方の約束（本テストが正本）:
 *   - type='project' のみ数える（personal スペースは個人の作業場＝課金対象外）
 *   - archived_at IS NULL のみ数える（片付ければ枠が空く）
 *   - 上限は resolveOrgLimits（将来のパック override の唯一の受け口）から解決する
 */

const mockResolveOrgLimits = vi.fn()
vi.mock('@/lib/billing/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/entitlements')>(
    '@/lib/billing/entitlements',
  )
  return { ...actual, resolveOrgLimits: (...args: unknown[]) => mockResolveOrgLimits(...args) }
})

const mockAdminClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockAdminClient(),
}))

import { orgProjectCapacity, isProjectLimitReached } from '@/lib/billing/projectCapacity'

const ORG_ID = '11111111-2222-3333-4444-555555555555'

/** spaces の count クエリを模す。適用されたフィルタを記録して検証できるようにする。 */
function makeAdmin(result: { count: number | null; error?: unknown }) {
  const filters: Record<string, unknown> = {}
  /** count クエリが await された時点で resolveOrgLimits が既に呼ばれていたか（＝並列で走ったか） */
  const timing = { limitsCallsWhenCountAwaited: -1 }
  const builder: Record<string, unknown> = {}
  const eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val
    return builder
  })
  const is = vi.fn((col: string, val: unknown) => {
    filters[`is:${col}`] = val
    return builder
  })
  Object.assign(builder, {
    eq,
    is,
    then: (resolve: (v: unknown) => unknown) => {
      timing.limitsCallsWhenCountAwaited = mockResolveOrgLimits.mock.calls.length
      return resolve({ count: result.count, error: result.error ?? null })
    },
  })
  const select = vi.fn(() => builder)
  const from = vi.fn(() => ({ select }))
  return { client: { from }, filters, from, select, timing }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('orgProjectCapacity', () => {
  it('active な project スペースだけを数え、プラン上限とともに返す', async () => {
    const admin = makeAdmin({ count: 2 })
    mockAdminClient.mockReturnValue(admin.client)
    mockResolveOrgLimits.mockResolvedValue({ maxProjects: 3 })

    const cap = await orgProjectCapacity(ORG_ID)

    expect(cap).toEqual({ activeCount: 2, maxProjects: 3 })
    expect(admin.from).toHaveBeenCalledWith('spaces')
    expect(admin.filters['org_id']).toBe(ORG_ID)
    // personal は課金対象外
    expect(admin.filters['type']).toBe('project')
    // アーカイブ済みは数えない（片付ければ枠が空く）
    expect(admin.filters['is:archived_at']).toBeNull()
  })

  it('上限 null（enterprise）は無制限として返す', async () => {
    mockAdminClient.mockReturnValue(makeAdmin({ count: 999 }).client)
    mockResolveOrgLimits.mockResolvedValue({ maxProjects: null })

    const cap = await orgProjectCapacity(ORG_ID)

    expect(cap).toEqual({ activeCount: 999, maxProjects: null })
  })

  it('件数の集計と上限の解決を並列で走らせる（プロジェクト作成の待ち時間を足し算にしない）', async () => {
    const admin = makeAdmin({ count: 2 })
    mockAdminClient.mockReturnValue(admin.client)
    mockResolveOrgLimits.mockResolvedValue({ maxProjects: 3 })

    await orgProjectCapacity(ORG_ID)

    // 直列だと count を待ってから resolveOrgLimits を呼ぶので、この時点の呼び出し回数は 0 になる。
    expect(admin.timing.limitsCallsWhenCountAwaited).toBe(1)
  })

  it('count が取れない場合は 0 ではなく上限到達として扱わない（countはnull→0）', async () => {
    mockAdminClient.mockReturnValue(makeAdmin({ count: null }).client)
    mockResolveOrgLimits.mockResolvedValue({ maxProjects: 3 })

    const cap = await orgProjectCapacity(ORG_ID)

    expect(cap.activeCount).toBe(0)
  })
})

describe('isProjectLimitReached', () => {
  it('上限 null は常に false（無制限）', () => {
    expect(isProjectLimitReached({ activeCount: 1000, maxProjects: null })).toBe(false)
  })
  it('上限未満は false', () => {
    expect(isProjectLimitReached({ activeCount: 2, maxProjects: 3 })).toBe(false)
  })
  it('ちょうど上限は true（次の1件を作らせない）', () => {
    expect(isProjectLimitReached({ activeCount: 3, maxProjects: 3 })).toBe(true)
  })
  it('既に上限超過（後から上限を導入した既存org）でも true＝新規のみ拒否', () => {
    expect(isProjectLimitReached({ activeCount: 12, maxProjects: 3 })).toBe(true)
  })
})

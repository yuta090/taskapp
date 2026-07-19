import { describe, it, expect } from 'vitest'
import { selectPreferredActiveGroup } from '@/lib/channels/store'
import type { ChannelGroup } from '@/lib/channels/store'

/**
 * selectPreferredActiveGroup — 1つのspaceに複数のactiveグループが同居する場合の決定的な選択。
 * コンソールは自社アカウント(owner_type='org')の文脈で動くため org を優先し、
 * 同順位は created_at 昇順（最古＝最初の接続）で決める。純関数。
 */

function group(id: string): ChannelGroup {
  return {
    id,
    orgId: 'org-1',
    spaceId: 'space-1',
    accountId: `acc-${id}`,
    externalGroupId: `G-${id}`,
    displayName: null,
    status: 'active',
    pickupMode: 'all',
    lastExtractedMessageCreatedAt: null,
    approverUserId: null,
  }
}

describe('selectPreferredActiveGroup', () => {
  it('候補が空ならnull', () => {
    expect(selectPreferredActiveGroup([])).toBeNull()
  })

  it('1件ならそれを返す', () => {
    const g = group('a')
    expect(selectPreferredActiveGroup([{ group: g, ownerType: 'platform', createdAt: '2026-01-01T00:00:00Z' }])).toBe(g)
  })

  it('自社アカウント(org)のグループを共通LINE(platform)より優先する', () => {
    const orgG = group('org')
    const platG = group('plat')
    const picked = selectPreferredActiveGroup([
      // created_at では platform の方が古いが、owner_type=org を優先する
      { group: platG, ownerType: 'platform', createdAt: '2026-01-01T00:00:00Z' },
      { group: orgG, ownerType: 'org', createdAt: '2026-02-01T00:00:00Z' },
    ])
    expect(picked).toBe(orgG)
  })

  it('同じowner_typeなら created_at 昇順（最古）を選ぶ', () => {
    const older = group('older')
    const newer = group('newer')
    const picked = selectPreferredActiveGroup([
      { group: newer, ownerType: 'org', createdAt: '2026-03-01T00:00:00Z' },
      { group: older, ownerType: 'org', createdAt: '2026-01-01T00:00:00Z' },
    ])
    expect(picked).toBe(older)
  })
})

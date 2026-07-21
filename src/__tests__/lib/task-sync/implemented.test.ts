import { describe, it, expect } from 'vitest'
import { TASK_SYNC_ADAPTERS } from '@/lib/task-sync/adapters'
import {
  IMPLEMENTED_TASK_SYNC_PROVIDERS,
  TASK_SYNC_PROVIDER_NEEDS_BASE_URL,
} from '@/lib/task-sync/implemented'

/**
 * client 安全な ID 一覧（implemented.ts）と、真実源のアダプタ登録表（adapters.ts）の parity。
 *
 * implemented.ts は Vercel/Turbopack build 対策で adapters.ts から分離した client 安全モジュール
 * （adapters.ts は redmine→ssrf.ts の node:dns/promises を引くため client から import できない）。
 * その代償として ID 一覧が2箇所になるので、片方だけに provider を足した drift をここで必ず落とす。
 */
describe('implemented.ts と adapters.ts の parity', () => {
  it('IMPLEMENTED_TASK_SYNC_PROVIDERS と TASK_SYNC_ADAPTERS のキーは集合として一致する', () => {
    const fromAdapters = Object.keys(TASK_SYNC_ADAPTERS).sort()
    const fromList = [...IMPLEMENTED_TASK_SYNC_PROVIDERS].sort()
    expect(fromList).toEqual(fromAdapters)
  })

  it('一覧に重複が無い', () => {
    const set = new Set(IMPLEMENTED_TASK_SYNC_PROVIDERS)
    expect(set.size).toBe(IMPLEMENTED_TASK_SYNC_PROVIDERS.length)
  })

  it('needsBaseUrl(client安全メタ) が各アダプタの hostPolicy.kind!==fixed と一致する', () => {
    for (const [id, adapter] of Object.entries(TASK_SYNC_ADAPTERS)) {
      const expected = adapter!.hostPolicy.kind !== 'fixed'
      expect(
        TASK_SYNC_PROVIDER_NEEDS_BASE_URL[id as keyof typeof TASK_SYNC_PROVIDER_NEEDS_BASE_URL],
        `${id}: needsBaseUrl should mirror hostPolicy.kind (${adapter!.hostPolicy.kind})`,
      ).toBe(expected)
    }
  })

  it('needsBaseUrl メタは実装済み provider だけをキーに持つ（余剰キーが無い）', () => {
    expect(Object.keys(TASK_SYNC_PROVIDER_NEEDS_BASE_URL).sort()).toEqual(
      [...IMPLEMENTED_TASK_SYNC_PROVIDERS].sort(),
    )
  })
})

import { describe, it, expect } from 'vitest'
import {
  hasChangedSinceDecision,
  latestDecisionVersion,
  versionKindLabel,
} from '@/lib/wiki/decisionVersions'
import type { WikiPageVersion } from '@/types/database'

const v = (over: Partial<WikiPageVersion> & { created_at: string }): WikiPageVersion =>
  ({
    id: `v-${over.created_at}`,
    org_id: 'o1',
    page_id: 'p1',
    title: 't',
    body: 'b',
    created_by: 'u1',
    kind: 'autosave',
    task_id: null,
    ...over,
  }) as WikiPageVersion

describe('latestDecisionVersion', () => {
  it('確定の控えが無ければ null', () => {
    expect(latestDecisionVersion([v({ created_at: '2026-09-14T01:00:00Z' })])).toBeNull()
    expect(latestDecisionVersion([])).toBeNull()
  })

  it('自動保存の控えは選ばない', () => {
    const versions = [
      v({ created_at: '2026-09-14T03:00:00Z' }),
      v({ created_at: '2026-09-14T02:00:00Z', kind: 'decided', task_id: 'task-1' }),
      v({ created_at: '2026-09-14T01:00:00Z' }),
    ]
    expect(latestDecisionVersion(versions)?.task_id).toBe('task-1')
  })

  it('確定が複数あればいちばん新しいものを選ぶ（並び順に依存しない）', () => {
    const versions = [
      v({ created_at: '2026-09-10T00:00:00Z', kind: 'decided', task_id: 'old' }),
      v({ created_at: '2026-09-14T00:00:00Z', kind: 'implemented', task_id: 'new' }),
      v({ created_at: '2026-09-12T00:00:00Z', kind: 'decided', task_id: 'mid' }),
    ]
    expect(latestDecisionVersion(versions)?.task_id).toBe('new')
  })
})

describe('hasChangedSinceDecision', () => {
  const decided = v({ created_at: '2026-09-14T02:00:00Z', kind: 'decided', task_id: 'task-1' })

  it('確定した直後は「変わっていない」（同じ時刻になる）', () => {
    // rpc_set_spec_state は同じトランザクションで版を作りページを更新するので now() が一致する
    expect(hasChangedSinceDecision('2026-09-14T02:00:00Z', decided)).toBe(false)
  })

  it('確定のあとに本文を保存したら「変わった」', () => {
    expect(hasChangedSinceDecision('2026-09-14T02:00:01Z', decided)).toBe(true)
  })

  it('確定より前の更新時刻なら「変わっていない」', () => {
    expect(hasChangedSinceDecision('2026-09-14T01:00:00Z', decided)).toBe(false)
  })

  it('確定の控えが無ければ「変わった」とは言わない', () => {
    expect(hasChangedSinceDecision('2026-09-14T02:00:01Z', null)).toBe(false)
  })

  it('更新時刻が読めないときは「変わった」とは言わない（誤って警告を出さない）', () => {
    expect(hasChangedSinceDecision('', decided)).toBe(false)
    expect(hasChangedSinceDecision('こわれた日付', decided)).toBe(false)
  })
})

describe('versionKindLabel', () => {
  it('確定・実装の控えには名札を出す', () => {
    expect(versionKindLabel('decided')).toBe('確定時点')
    expect(versionKindLabel('implemented')).toBe('実装時点')
  })

  it('自動保存には名札を出さない', () => {
    expect(versionKindLabel('autosave')).toBeNull()
  })

  it('知らない種類でも落ちない', () => {
    expect(versionKindLabel(undefined)).toBeNull()
    expect(versionKindLabel('なにか' as never)).toBeNull()
  })
})

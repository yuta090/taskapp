import { describe, it, expect } from 'vitest'
import {
  INTEGRATION_SETUP_GUIDES,
  PERSONAL_SETUP_GUIDE_KEYS,
  getSetupGuide,
  type PersonalSetupGuideKey,
} from '@/lib/integrations/setupGuides'
import { listIntegrations } from '@/lib/integrations/registry'

/**
 * ツール連携の「連携のしかた」手順 — 単一の真実源。
 *
 * ここが守る約束は2つだけ:
 *   1. **使えるツールには必ず手順がある**（status !== 'planned' なのに手順が無い＝
 *      接続画面にAPIキー欄だけが出て、どこで取るのか分からない状態を作らない）
 *   2. **使えないツールには手順を置かない**（planned に手順を書くと「今すぐ繋げる」と
 *      誤解させる。planned は ToolConnectOverview の「近日」案内が担当する）
 */
describe('INTEGRATION_SETUP_GUIDES', () => {
  const available = listIntegrations().filter((d) => d.status !== 'planned')
  const planned = listIntegrations().filter((d) => d.status === 'planned')

  it.each(available.map((d) => [d.id, d.label]))(
    '利用可能なツール(%s: %s)には必ず連携手順がある',
    (id) => {
      expect(getSetupGuide(id)).not.toBeNull()
    },
  )

  it.each(planned.map((d) => [d.id, d.label]))(
    'planned(%s: %s)には手順を置かない（今すぐ繋げると誤解させない）',
    (id) => {
      expect(getSetupGuide(id)).toBeNull()
    },
  )

  it('各手順は「何ができるか」と2つ以上の具体的な操作を持つ', () => {
    for (const [key, guide] of Object.entries(INTEGRATION_SETUP_GUIDES)) {
      expect(guide.summary.length, `${key}: summary が空`).toBeGreaterThan(0)
      expect(guide.steps.length, `${key}: steps が少なすぎる`).toBeGreaterThanOrEqual(2)
      for (const step of guide.steps) {
        expect(step.length, `${key}: 空の step がある`).toBeGreaterThan(0)
      }
    }
  })

  it('個人アカウント接続(設定→ツール連携)の4つにも手順がある', () => {
    const expected: PersonalSetupGuideKey[] = [
      'google_calendar',
      'google_tasks_personal',
      'zoom',
      'teams',
    ]
    expect([...PERSONAL_SETUP_GUIDE_KEYS].sort()).toEqual([...expected].sort())
    for (const key of expected) {
      expect(getSetupGuide(key), `${key} の手順が無い`).not.toBeNull()
    }
  })

  it('未知のキーはnullを返す（呼び出し側でボタンごと出さない判断ができる）', () => {
    expect(getSetupGuide('unknown_tool')).toBeNull()
  })

  it('個人のGoogle ToDoは組織のGoogle Tasks連携とは別の手順にする（混同させない）', () => {
    const personal = getSetupGuide('google_tasks_personal')
    const org = getSetupGuide('google_tasks')
    expect(personal).not.toBeNull()
    expect(org).not.toBeNull()
    expect(personal!.summary).not.toBe(org!.summary)
  })
})

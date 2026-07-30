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

  /**
   * 手順を記憶で書いてしまい、実際の画面と食い違っていた——という実際の失敗から入れた歯止め。
   * 「どこを見て書いたか」「いつ時点か」を必ず残させる。
   */
  it('全ての手順に、裏を取った資料と確認日が残っている', () => {
    for (const [key, guide] of Object.entries(INTEGRATION_SETUP_GUIDES)) {
      expect(guide.sources.length, `${key}: sources が空（裏を取らずに書いていないか）`).toBeGreaterThan(0)
      expect(guide.verifiedOn, `${key}: verifiedOn の形式が不正`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('TaskApp側の道順は「接続画面」のような曖昧語で書かない（どの画面か分からないため）', () => {
    for (const [key, guide] of Object.entries(INTEGRATION_SETUP_GUIDES)) {
      for (const step of guide.steps) {
        expect(step, `${key}: 「接続画面」は利用者に伝わらない`).not.toMatch(/接続画面/)
      }
    }
  })

  /**
   * 手順は「これから使う人」だけが読む。運用者（TaskApp を導入した側）が最初に一度だけやる
   * 準備作業や、TaskApp 内部の作りの説明を混ぜない。混ぜると、関係の無い人まで
   * その作業をやりに行ってしまう（Trello で実際にそうなった）。
   */
  it('運用側の準備作業や内部の作りを、利用者向けの手順に混ぜない', () => {
    const OPERATOR_ONLY = [
      /Power-Up/,
      /運用担当/,
      /運用者/,
      /接続フォームに無く/,
      /作りにしている/,
      /接続を許可しているドメイン/,
    ]
    for (const [key, guide] of Object.entries(INTEGRATION_SETUP_GUIDES)) {
      for (const text of [guide.summary, ...guide.steps, ...(guide.notes ?? [])]) {
        for (const pattern of OPERATOR_ONLY) {
          expect(text, `${key}: 運用側の話が利用者向けに漏れている`).not.toMatch(pattern)
        }
      }
    }
  })

  it('全ツール共通の注意（owner/admin限定）を、ツールごとに書き写していない', () => {
    for (const [key, guide] of Object.entries(INTEGRATION_SETUP_GUIDES)) {
      for (const note of guide.notes ?? []) {
        expect(note, `${key}: 共通の注意は adminOnly で表す`).not.toMatch(
          /この接続を作れるのは、組織のオーナーか管理者だけ/,
        )
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

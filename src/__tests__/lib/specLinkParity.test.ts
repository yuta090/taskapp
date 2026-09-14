import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeSpecLinkChanges } from '../../../packages/mcp-server/src/lib/specLink'

/**
 * Wiki ページを紐づけたときの「決定事項のタスクになるか」の規則は、画面（useTasks の
 * specChangesForWikiLink）と CLI（packages/mcp-server の computeSpecLinkChanges）の
 * **2か所にある**。片方だけ直すと、同じ操作なのに画面と CLI で結果が変わり、
 * CLI から紐づけたときだけ「決まるまで完了できない」歯止めが効かなくなる。
 *
 * パッケージをまたぐので実装は共有できない。ここで振る舞いを突き合わせる
 * （appLinks.crossPackage.test.ts と同じ考え方）。
 */

describe('computeSpecLinkChanges: 画面と同じ規則', () => {
  it('外す（null）ならふつうのタスクに戻す', () => {
    expect(
      computeSpecLinkChanges({ wikiPageId: null, isSpecPage: false, currentDecisionState: 'decided' })
    ).toEqual({ type: 'task', decision_state: null })
  })

  it('仕様書のページを紐づけると、決定事項のタスクにして検討中を入れる', () => {
    expect(
      computeSpecLinkChanges({ wikiPageId: 'p1', isSpecPage: true, currentDecisionState: null })
    ).toEqual({ type: 'spec', decision_state: 'considering' })
  })

  it('既に決定の状態があるなら消さない（付け替えで確定を巻き戻さない）', () => {
    expect(
      computeSpecLinkChanges({ wikiPageId: 'p1', isSpecPage: true, currentDecisionState: 'decided' })
    ).toEqual({ type: 'spec' })
  })

  it('参考資料（タグ無し）ならリンクだけで、完了を止めない', () => {
    expect(
      computeSpecLinkChanges({ wikiPageId: 'p1', isSpecPage: false, currentDecisionState: null })
    ).toEqual({})
  })
})

describe('画面側の実装と突き合わせる', () => {
  const screen = readFileSync(join(__dirname, '../../lib/hooks/useTasks.ts'), 'utf-8')

  it('画面側も「外す＝task に戻す」を持つ', () => {
    expect(screen).toContain("return { type: 'task', decision_state: null }")
  })

  it('画面側も「タグ無しは変えない」を持つ', () => {
    expect(screen).toContain('if (input.wikiPageIsSpec === false) return {}')
  })

  it('画面側も「未決なら検討中を入れる」を持つ', () => {
    expect(screen).toContain(
      "return current?.decision_state ? { type: 'spec' } : { type: 'spec', decision_state: 'considering' }"
    )
  })

  it('CLI 側は「仕様書」タグの綴りを画面と揃えている', () => {
    const cli = readFileSync(
      join(__dirname, '../../../packages/mcp-server/src/lib/specLink.ts'),
      'utf-8'
    )
    expect(cli).toContain("export const SPEC_TAG = '仕様書'")
    // 画面側（WikiPageInspector / WikiPageLinkPicker）と同じ文字列であること
    const picker = readFileSync(join(__dirname, '../../components/task/WikiPageLinkPicker.tsx'), 'utf-8')
    expect(picker).toContain("'仕様書'")
  })
})

/**
 * Wiki ページを紐づけたときに、タスクの種類と決定の状態がどう変わるか。
 *
 * **画面（`src/lib/hooks/useTasks.ts` の `specChangesForWikiLink`）と同じ規則**にする。
 * 揃えないと、CLI から仕様書ページを紐づけても「決定事項のタスク」にならず、
 * 「決まるまで完了できない」歯止めも効かない（画面と CLI で結果が違う）。
 *
 *   - 外す(null)            … ふつうのタスクに戻す
 *   - 「仕様書」タグ付き     … 決定事項のタスクにする。未決なら検討中を入れる
 *   - タグ無し（参考資料）   … リンクだけ。検討中にすると決定まで完了できなくなるので変えない
 *
 * 規則そのものは純関数にしてテストで突き合わせ、DB を引く部分は呼び出し側に置く。
 */

export const SPEC_TAG = '仕様書'

export interface SpecLinkChanges {
  type?: 'task' | 'spec'
  decision_state?: 'considering' | 'decided' | 'implemented' | null
}

export function computeSpecLinkChanges(input: {
  /** 紐づける Wiki ページ。null は「外す」 */
  wikiPageId: string | null
  /** そのページが「仕様書として扱う」か。外すときは見ない */
  isSpecPage: boolean
  /** いまの決定の状態（付け替えのときに消さないため） */
  currentDecisionState: string | null
}): SpecLinkChanges {
  if (input.wikiPageId === null) return { type: 'task', decision_state: null }
  if (!input.isSpecPage) return {}
  return input.currentDecisionState
    ? { type: 'spec' }
    : { type: 'spec', decision_state: 'considering' }
}

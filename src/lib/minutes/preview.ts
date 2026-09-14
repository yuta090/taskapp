/**
 * 議事録のタスク化「候補」を、DB から返ってきた形から画面用の形へ直す。
 *
 * 候補には2種類ある:
 *   - 旧来の SPEC 行（`- [ ] SPEC(/spec/FILE.md#anchor): 題名`）… `specPath` が入る
 *   - Wiki ページへのリンクが入った未チェック行 … `wikiPageId` / `wikiPageTitle` が入る
 *
 * 画面（MeetingInspector）は「題名」と、その下に出す1行（Wiki のページ名か仕様書のパス）
 * だけを使う。どちらの種類かで分岐せずに書けるよう、ここで形をそろえる。
 */

/** DB（rpc_get_minutes_preview）が返す1行。種類によって入る鍵が違う。 */
export interface RawMinutesPreviewLine {
  line_number: number
  title: string
  spec_path?: string | null
  wiki_page_id?: string | null
  wiki_page_title?: string | null
  is_spec?: boolean | null
  task_id?: string | null
}

export interface RawMinutesPreview {
  new_spec_count: number
  existing_spec_count: number
  new_specs?: RawMinutesPreviewLine[] | null
  existing_specs?: RawMinutesPreviewLine[] | null
}

export interface MinutesPreviewCandidate {
  lineNumber: number
  title: string
  /** 旧来の SPEC 行のときだけ入る */
  specPath: string | null
  /** Wiki ページに紐づく行のときだけ入る */
  wikiPageId: string | null
  wikiPageTitle: string | null
  /** 決定事項のタスク（決まるまで完了できない）になるかどうか */
  isSpec: boolean
}

export interface MinutesPreviewExisting extends MinutesPreviewCandidate {
  taskId: string
}

export interface MinutesPreviewView {
  newSpecCount: number
  existingSpecCount: number
  newSpecs: MinutesPreviewCandidate[]
  existingSpecs: MinutesPreviewExisting[]
}

function toCandidate(line: RawMinutesPreviewLine): MinutesPreviewCandidate {
  const specPath = line.spec_path ?? null
  return {
    lineNumber: line.line_number,
    title: line.title,
    specPath,
    wikiPageId: line.wiki_page_id ?? null,
    wikiPageTitle: line.wiki_page_title ?? null,
    // 旧来の SPEC 行は常に決定事項のタスク。Wiki の行は「仕様書」タグの有無を DB が入れてくる
    isSpec: line.is_spec ?? specPath !== null,
  }
}

export function toMinutesPreview(raw: RawMinutesPreview): MinutesPreviewView {
  return {
    newSpecCount: raw.new_spec_count,
    existingSpecCount: raw.existing_spec_count,
    newSpecs: (raw.new_specs ?? []).map(toCandidate),
    existingSpecs: (raw.existing_specs ?? []).map((line) => ({
      ...toCandidate(line),
      taskId: line.task_id ?? '',
    })),
  }
}

/** 候補の題名の下に出す1行。Wiki のページ名を優先する（人が読んで分かるのはこちら）。 */
export function candidateSubLabel(candidate: MinutesPreviewCandidate): string {
  return candidate.wikiPageTitle ?? candidate.specPath ?? ''
}

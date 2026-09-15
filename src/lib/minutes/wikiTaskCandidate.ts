/**
 * 議事録の1行から「Wiki ページに紐づくタスク（タスク）の候補」を取り出す。
 *
 * 規則は「**未チェックのチェックリスト行は、ぜんぶ候補**」。書き方を新しく覚える必要はない。
 * その行に Wiki ページへのリンクが入っていれば、そのページが紐づく（「/」→ Wiki で差し込む）。
 *
 * はじめは「Wiki ページのリンクがある行だけ」にしていたが、議事録には
 * 「田畠さんにレビュー依頼」のような**ただのやること**も普通に出てくる。書いたのに候補に
 * 出ず、理由も画面に出ないのがいちばん困るので、リンクの有無で拾う・拾わないを分けない。
 *
 * 旧来の書き方 `- [ ] SPEC(/spec/FILE.md#anchor): 題名` は開発用の仕様書ファイルしか
 * 指せない。そちらは既存の経路が扱うので、この判定では拾わない。
 *
 * 下の `export` したパターン文字列は **SQL 側（rpc_get_minutes_preview /
 * rpc_parse_meeting_minutes）と同じ文字列**を使う。片方だけ直すと、画面に出る候補一覧と
 * 実際に作られるタスクが食い違う。`src/__tests__/lib/minutes/wikiTaskCandidate.test.ts`
 * が最新のマイグレーションから探して突き合わせる。
 */

/** 未チェックのチェックリスト行（`- [ ] 中身`）。`[x]` `[X]` は含めない。 */
export const UNCHECKED_ITEM_PATTERN = '^-\\s*\\[\\s*\\]\\s*(.+)$'

/**
 * Wiki ページへのリンク先（`buildWikiPageHref` が作る形）から、ページの ID を取り出す。
 * UUID の形に限る — 緩くすると `?page=2` のような別物を拾って外部キーで落ちる。
 */
export const WIKI_PAGE_HREF_PATTERN =
  '/wiki\\?page=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'

/** 旧来の SPEC 行。こちらに一致する行は既存の経路が扱うので、この判定では拾わない。 */
const SPEC_ITEM_PATTERN = '^-\\s*\\[\\s*\\]\\s*SPEC\\([^)]+\\):\\s*.+$'

/** 行末のタスク化済みの目印。題名からは取り除く。 */
const TASK_MARKER_PATTERN = '<!--task:[^>]+-->\\s*$'

/** Markdown のリンク `[文字](先)`。題名を組み立てるときに取り除く。 */
const MARKDOWN_LINK_PATTERN = '\\[([^\\]]*)\\]\\(([^)]*)\\)'

/**
 * 行に書かれた期限（`期限: 9/20` `期限: 2026/9/20`）。**題名からは取り除く**。
 *
 * 期限そのものは行の文字から別に読み取って日付の欄に入る。題名にも残すと一覧に
 * 「見積を出す（期限: 9/20）」と出てしまい、あとで期限を変えても名前だけ古い日付の
 * ままになる。前後の丸括弧（半角・全角）も一緒に外す。括弧が無くても外す。
 *
 * 日付の形は、期限として読み取る側（SQL の `期限:\s*(\d+/\d+(?:/\d+)?)`）と同じにする。
 * 揃えておかないと「題名からは消えたのに期限が入らない」行が出る。
 */
export const DUE_IN_TITLE_PATTERN = '\\s*[（(]?\\s*期限:\\s*\\d+/\\d+(?:/\\d+)?\\s*[）)]?'

/**
 * 担当者・マイルストーンの印（`<!--assignee:uuid 田中-->` `<!--milestone:uuid 第1弾-->`）。
 * 中身は担当者とマイルストーンとして読み取るので、**題名からは取り除く**。
 * 印の並びは行末だが、手で動かされていても拾えるよう行のどこにあっても外す。
 */
export const TASK_META_MARKER_PATTERN = '\\s*<!--(assignee|milestone):[^>]*-->'

export interface WikiTaskCandidate {
  /** 紐づける Wiki ページの ID */
  /** 紐づける Wiki ページの ID。リンクが無い行では null（ふつうのタスクになる） */
  pageId: string | null
  /** タスクの名前。行の文字からリンクと目印を取り除いたもの（空ならリンクの文字） */
  title: string
  /** 拾った Wiki リンクの表示文字（題名が空のときの代わりに使う） */
  linkText: string
}

/**
 * 1 行を見て、Wiki ページに紐づくタスクの候補なら中身を返す。候補でなければ null。
 *
 * タスク化済みの目印が付いた行も候補として返す。新規と作成済みの振り分けは、
 * 目印の有無を見る呼び出し側（SQL 側の preview / parse）が行う。
 */
export function findWikiTaskCandidate(line: string): WikiTaskCandidate | null {
  if (new RegExp(SPEC_ITEM_PATTERN).test(line)) return null

  const item = new RegExp(UNCHECKED_ITEM_PATTERN).exec(line)
  if (!item) return null
  const body = item[1]

  // Wiki ページのリンクがあれば紐づける。無くても候補にする（ふつうのタスクになる）
  const hrefMatch = new RegExp(WIKI_PAGE_HREF_PATTERN).exec(body)
  const pageId = hrefMatch ? hrefMatch[1] : null

  // 紐づけるページを指しているリンクの表示文字を取る（題名が空のときの代わり）
  let linkText = ''
  if (pageId !== null) {
    const linkRe = new RegExp(MARKDOWN_LINK_PATTERN, 'g')
    for (let m = linkRe.exec(body); m !== null; m = linkRe.exec(body)) {
      if (m[2].includes(pageId)) {
        linkText = m[1].trim()
        break
      }
    }
  }

  const title = body
    .replace(new RegExp(TASK_MARKER_PATTERN), '')
    // 担当者・マイルストーンはそれぞれの欄に入るので、題名には残さない
    .replace(new RegExp(TASK_META_MARKER_PATTERN, 'g'), '')
    .replace(new RegExp(MARKDOWN_LINK_PATTERN, 'g'), '')
    // 期限は日付の欄に入るので、題名には残さない
    .replace(new RegExp(DUE_IN_TITLE_PATTERN, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()

  const resolved = title !== '' ? title : linkText
  if (resolved === '') return null

  return { pageId, title: resolved, linkText }
}

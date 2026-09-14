/**
 * 議事録の1行から「Wiki ページに紐づく札（タスク）の候補」を取り出す。
 *
 * 旧来の書き方 `- [ ] SPEC(/spec/FILE.md#anchor): 題名` は開発用の仕様書ファイルしか
 * 指せず、打ち合わせで使う Wiki ページを指定できなかった。そこで
 * 「未チェックのチェックリスト行に Wiki ページへのリンクが入っていたら候補にする」
 * という規則を足す。書き方を新しく覚える必要はなく、本文にリンクを差し込む既存の
 * 操作（「/」→ Wiki）がそのまま使える。
 *
 * 下の 2 つのパターン文字列は **SQL 側（rpc_get_minutes_preview /
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

export interface WikiTaskCandidate {
  /** 紐づける Wiki ページの ID */
  pageId: string
  /** 札の名前。行の文字からリンクと目印を取り除いたもの（空ならリンクの文字） */
  title: string
  /** 拾った Wiki リンクの表示文字（題名が空のときの代わりに使う） */
  linkText: string
}

/**
 * 1 行を見て、Wiki ページに紐づく札の候補なら中身を返す。候補でなければ null。
 *
 * タスク化済みの目印が付いた行も候補として返す。新規と作成済みの振り分けは、
 * 目印の有無を見る呼び出し側（SQL 側の preview / parse）が行う。
 */
export function findWikiTaskCandidate(line: string): WikiTaskCandidate | null {
  if (new RegExp(SPEC_ITEM_PATTERN).test(line)) return null

  const item = new RegExp(UNCHECKED_ITEM_PATTERN).exec(line)
  if (!item) return null
  const body = item[1]

  const hrefMatch = new RegExp(WIKI_PAGE_HREF_PATTERN).exec(body)
  if (!hrefMatch) return null
  const pageId = hrefMatch[1]

  // 拾ったページを指しているリンクの表示文字を取る（題名が空のときの代わり）
  let linkText = ''
  const linkRe = new RegExp(MARKDOWN_LINK_PATTERN, 'g')
  for (let m = linkRe.exec(body); m !== null; m = linkRe.exec(body)) {
    if (m[2].includes(pageId)) {
      linkText = m[1].trim()
      break
    }
  }

  const title = body
    .replace(new RegExp(TASK_MARKER_PATTERN), '')
    .replace(new RegExp(MARKDOWN_LINK_PATTERN, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()

  const resolved = title !== '' ? title : linkText
  if (resolved === '') return null

  return { pageId, title: resolved, linkText }
}

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  findWikiTaskCandidate,
  DUE_IN_TITLE_PATTERN,
  TASK_META_MARKER_PATTERN,
  UNCHECKED_ITEM_PATTERN,
  WIKI_PAGE_HREF_PATTERN,
} from '@/lib/minutes/wikiTaskCandidate'

const PAGE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTHER_PAGE_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const href = (pageId: string) => `/org-1/project/space-1/wiki?page=${pageId}`

describe('findWikiTaskCandidate: 拾う行', () => {
  it('未チェックの行に Wiki ページのリンクがあれば候補になる', () => {
    const line = `- [ ] 玄関の向きを決める [家の間取り](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toEqual({
      pageId: PAGE_ID,
      title: '玄関の向きを決める',
      linkText: '家の間取り',
    })
  })

  it('リンクが行の先頭にあっても題名を取り違えない', () => {
    const line = `- [ ] [家の間取り](${href(PAGE_ID)}) リビングの広さを決める`
    expect(findWikiTaskCandidate(line)).toMatchObject({
      pageId: PAGE_ID,
      title: 'リビングの広さを決める',
    })
  })

  it('タスク化済みの目印が付いていても候補として返す（新旧の振り分けは呼び出し側）', () => {
    const line = `- [ ] 玄関の向きを決める [家の間取り](${href(PAGE_ID)}) <!--task:${OTHER_PAGE_ID}-->`
    expect(findWikiTaskCandidate(line)).toMatchObject({ pageId: PAGE_ID, title: '玄関の向きを決める' })
  })

  it('題名が空ならリンクの文字を題名にする', () => {
    const line = `- [ ] [水回りの位置](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toMatchObject({ pageId: PAGE_ID, title: '水回りの位置' })
  })

  it('Wiki 以外のリンクが混ざっていても Wiki のリンクを拾う', () => {
    const line = `- [ ] 決める [資料](/org-1/project/space-1/files) [間取り](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toMatchObject({ pageId: PAGE_ID })
  })

  it('先頭の Wiki リンクを採る（1行に2つあってもタスクは1つ）', () => {
    const line = `- [ ] 決める [A](${href(PAGE_ID)}) [B](${href(OTHER_PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toMatchObject({ pageId: PAGE_ID })
  })

  it('チェックボックスの前後に空白があっても拾う', () => {
    const line = `-   [ ]   玄関を決める [間取り](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toMatchObject({ pageId: PAGE_ID, title: '玄関を決める' })
  })
})

describe('findWikiTaskCandidate: 拾わない行', () => {
  it('チェック済みの行は拾わない', () => {
    expect(findWikiTaskCandidate(`- [x] 決める [間取り](${href(PAGE_ID)})`)).toBeNull()
    expect(findWikiTaskCandidate(`- [X] 決める [間取り](${href(PAGE_ID)})`)).toBeNull()
  })

  it('チェックリストでない行は拾わない', () => {
    expect(findWikiTaskCandidate(`- 決める [間取り](${href(PAGE_ID)})`)).toBeNull()
    expect(findWikiTaskCandidate(`決める [間取り](${href(PAGE_ID)})`)).toBeNull()
  })

  // リンクが無い行も拾うようになった（下の「リンクの無い行」の節で確かめる）。
  // ここでは「ページは紐づかない」ことだけ見る
  it('Wiki のリンクが無ければ、ページは紐づかない', () => {
    expect(findWikiTaskCandidate('- [ ] ただの作業')?.pageId).toBeNull()
    expect(findWikiTaskCandidate('- [ ] 作業 [ファイル](/api/files/abc/download)')?.pageId).toBeNull()
  })

  it('旧来の SPEC 行は拾わない（そちらの経路が扱う）', () => {
    const line = `- [ ] SPEC(/spec/REVIEW_SPEC.md#x): タイトル [間取り](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toBeNull()
  })

  it('page= の値が UUID の形でなければ、ページは紐づかない（行自体は候補になる）', () => {
    expect(findWikiTaskCandidate('- [ ] 決める [間取り](/o/project/s/wiki?page=abc)')?.pageId).toBeNull()
    expect(findWikiTaskCandidate('- [ ] 決める [間取り](/o/project/s/wiki)')?.pageId).toBeNull()
  })

  it('題名もリンクの文字も空なら拾わない（タスクの名前が作れない）', () => {
    expect(findWikiTaskCandidate(`- [ ] [](${href(PAGE_ID)})`)).toBeNull()
  })
})

/**
 * SQL 側（最新マイグレーション）から、この判定に使うパターンをそのまま切り出して
 * TS 側の定数と文字列として一致することを確かめる。片方だけ直すと、画面の
 * 候補一覧と実際に作られるタスクが食い違う（既存の SPEC_LINE_REGEX と同じ考え方）。
 */
function readLatestMigrationDefining(fnName: string): { file: string; sql: string } {
  const dir = join(__dirname, '../../../../supabase/migrations')
  const defines = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${fnName}`, 'i')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(dir, files[i]), 'utf-8')
    if (defines.test(sql)) return { file: files[i], sql }
  }
  throw new Error(`${fnName} を定義するマイグレーションが見つかりません`)
}

/**
 * ファイル全体ではなく、その関数の定義だけを切り出す。2 つの関数が同じファイルに
 * 入っているので、ファイル単位で見ると「片方だけパターンを落とした」を見逃す。
 * （markdown.test.ts の sliceFunctionBody と同じ考え方）
 */
function sliceFunctionBody(sql: string, fnName: string): string {
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${fnName}\\b`, 'i').exec(sql)
  if (!head) throw new Error(`${fnName} の定義が見つかりません（切り出せませんでした）`)
  const rest = sql.slice(head.index + head[0].length)
  const next = /create\s+or\s+replace\s+function/i.exec(rest)
  return head[0] + (next ? rest.slice(0, next.index) : rest)
}

/**
 * 行の判定は `_impl`（実行者を引数で受ける本体）に入っている。画面用 `rpc_*` と
 * 道具用 `rpc_*_as` はそれを呼ぶだけの包みなので、正規表現は本体側を見る
 * （20260914124023 で分割した。分けた直後にこの検査が落ちて気づけた）。
 */
describe('SQL と共有するパターン', () => {
  for (const fn of ['_get_minutes_preview_impl', '_parse_meeting_minutes_impl']) {
    it(`${fn} が同じ Wiki リンクのパターンを持つ`, () => {
      const { sql } = readLatestMigrationDefining(fn)
      expect(sliceFunctionBody(sql, fn)).toContain(WIKI_PAGE_HREF_PATTERN)
    })

    it(`${fn} が同じ未チェック行のパターンを持つ`, () => {
      const { sql } = readLatestMigrationDefining(fn)
      expect(sliceFunctionBody(sql, fn)).toContain(UNCHECKED_ITEM_PATTERN)
    })

    it(`${fn} が同じ「期限を題名から外す」パターンを持つ`, () => {
      const { sql } = readLatestMigrationDefining(fn)
      expect(sliceFunctionBody(sql, fn)).toContain(DUE_IN_TITLE_PATTERN)
    })

    it(`${fn} が同じ「担当者・マイルストーンの印を題名から外す」パターンを持つ`, () => {
      const { sql } = readLatestMigrationDefining(fn)
      expect(sliceFunctionBody(sql, fn)).toContain(TASK_META_MARKER_PATTERN)
    })
  }

  // 包みが本体を呼んでいること（呼び忘れると、判定はあるのに誰も通らない）
  for (const [wrapper, impl] of [
    ['rpc_get_minutes_preview', '_get_minutes_preview_impl'],
    ['rpc_get_minutes_preview_as', '_get_minutes_preview_impl'],
    ['rpc_parse_meeting_minutes', '_parse_meeting_minutes_impl'],
    ['rpc_parse_meeting_minutes_as', '_parse_meeting_minutes_impl'],
  ]) {
    it(`${wrapper} が ${impl} を呼ぶ`, () => {
      const { sql } = readLatestMigrationDefining(wrapper)
      expect(sliceFunctionBody(sql, wrapper)).toContain(`public.${impl}(`)
    })
  }
})

/**
 * リンクの無いチェックリスト行も、ふつうのタスクとして拾う。
 *
 * もともと「決めること」を拾う仕組みとして作ったので、資料が必ず紐づく前提だった。
 * だが議事録には「田畠さんにレビュー依頼」のような**ただのやること**も普通に出てくる。
 * 書いたのに候補に出ず、理由も画面に出ないのがいちばん困る（ユーザー指摘）。
 */
describe('findWikiTaskCandidate: リンクの無い行', () => {
  it('リンクが無くても、未チェックの行なら拾う（ページは紐づかない）', () => {
    const got = findWikiTaskCandidate('- [ ] 田畠さんに販売戦略のレビュー依頼')
    expect(got).toEqual({
      pageId: null,
      title: '田畠さんに販売戦略のレビュー依頼',
      linkText: '',
    })
  })

  it('Wiki 以外のリンクだけでも拾う（リンクは題名から取り除く）', () => {
    const got = findWikiTaskCandidate('- [ ] 資料を送る [見積書](/api/files/abc/download)')
    expect(got).toMatchObject({ pageId: null, title: '資料を送る' })
  })

  it('チェック済みは拾わない', () => {
    expect(findWikiTaskCandidate('- [x] 済んだこと')).toBeNull()
  })

  it('チェックリストでない行は拾わない', () => {
    expect(findWikiTaskCandidate('- ただの箇条書き')).toBeNull()
    expect(findWikiTaskCandidate('ふつうの文')).toBeNull()
  })

  it('中身が空の行は拾わない（タスクの名前が作れない）', () => {
    expect(findWikiTaskCandidate('- [ ] ')).toBeNull()
    expect(findWikiTaskCandidate('- [ ]')).toBeNull()
  })

  it('旧来の SPEC 行は、これまでどおりそちらの経路が扱う', () => {
    expect(findWikiTaskCandidate('- [ ] SPEC(/spec/A.md#x): タイトル')).toBeNull()
  })
})

/**
 * 担当者・マイルストーンの印も、読み取るだけで**題名には残さない**。
 * 残ると一覧に「見積を出す <!--assignee:...-->」と出てしまう。
 */
describe('findWikiTaskCandidate: 担当者・マイルストーンの印は題名に残さない', () => {
  const USER = '22222222-3333-4444-5555-666666666666'
  const MILESTONE = '77777777-8888-9999-aaaa-bbbbbbbbbbbb'

  it('担当者の印を外す', () => {
    expect(findWikiTaskCandidate(`- [ ] 見積を出す <!--assignee:${USER} 田中-->`)?.title).toBe('見積を出す')
  })

  it('マイルストーンの印を外す', () => {
    expect(findWikiTaskCandidate(`- [ ] 見積を出す <!--milestone:${MILESTONE} 第1弾-->`)?.title).toBe(
      '見積を出す'
    )
  })

  it('印が3つ並んでも題名は残る', () => {
    const line = `- [ ] 見積を出す（期限: 9/20） <!--assignee:${USER} 田中--> <!--milestone:${MILESTONE} 第1弾--> <!--task:abc-->`
    expect(findWikiTaskCandidate(line)?.title).toBe('見積を出す')
  })

  it('印しかない行は拾わない（タスクの名前が作れない）', () => {
    expect(findWikiTaskCandidate(`- [ ] <!--assignee:${USER} 田中-->`)).toBeNull()
  })
})

/**
 * 「期限: 9/20」の書き方は、期限として読み取るだけで**題名には残さない**。
 * 残ると一覧に「見積を出す（期限: 9/20）」と出てしまい、あとで期限を変えたときに
 * 名前だけ古い日付のままになる。
 */
describe('findWikiTaskCandidate: 期限の書き方は題名に残さない', () => {
  it('半角の括弧で囲まれた期限を外す', () => {
    expect(findWikiTaskCandidate('- [ ] 見積を出す(期限: 9/20)')?.title).toBe('見積を出す')
  })

  it('全角の括弧で囲まれた期限を外す', () => {
    expect(findWikiTaskCandidate('- [ ] 見積を出す（期限: 9/20）')?.title).toBe('見積を出す')
  })

  it('括弧が無くても外す', () => {
    expect(findWikiTaskCandidate('- [ ] 見積を出す 期限: 9/20')?.title).toBe('見積を出す')
  })

  it('年まで書いてあっても外す', () => {
    expect(findWikiTaskCandidate('- [ ] 見積を出す（期限: 2026/9/20）')?.title).toBe('見積を出す')
  })

  it('行の途中にあっても外す', () => {
    expect(findWikiTaskCandidate('- [ ] 資料を送る（期限: 9/20）と、見積も出す')?.title).toBe(
      '資料を送ると、見積も出す'
    )
  })

  it('行の先頭にあっても外す', () => {
    expect(findWikiTaskCandidate('- [ ] 期限: 9/20 見積を出す')?.title).toBe('見積を出す')
  })

  it('期限が無い行はそのまま', () => {
    expect(findWikiTaskCandidate('- [ ] 見積を出す')?.title).toBe('見積を出す')
  })

  it('日付が入っていない「期限: 未定」は外さない（期限としても読めない）', () => {
    expect(findWikiTaskCandidate('- [ ] 見積を出す（期限: 未定）')?.title).toBe(
      '見積を出す（期限: 未定）'
    )
  })

  it('Wiki ページのリンクと一緒でも、題名だけ残る', () => {
    const line = `- [ ] 玄関の向きを決める（期限: 9/20） [家の間取り](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toMatchObject({
      pageId: PAGE_ID,
      title: '玄関の向きを決める',
    })
  })

  it('期限だけの行は拾わない（タスクの名前が残らない）', () => {
    expect(findWikiTaskCandidate('- [ ] （期限: 9/20）')).toBeNull()
  })

  it('期限だけでもリンクがあれば、リンクの文字を題名にする', () => {
    const line = `- [ ] （期限: 9/20）[水回りの位置](${href(PAGE_ID)})`
    expect(findWikiTaskCandidate(line)).toMatchObject({ pageId: PAGE_ID, title: '水回りの位置' })
  })
})

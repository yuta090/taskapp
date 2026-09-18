import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * タスク化で作る決定事項（spec）のタスクは、ボールを社内に置き、社内側の担当を1人入れる。
 *
 * 「決めてください」の催促（process_spec_decision_nudges）は task_owners.side = tasks.ball
 * の人にしか届かない。ボールが 'client' で顧客側の担当が居ないと、期限を過ぎても会議が
 * 終わっても誰にも届かず、受信トレイの「仕様決定」タブが空のままになる。実際にそうなった
 * （決定事項のタスク13件がすべて ball='client' / 担当0人）ので、作る側を直した。
 *
 * SQL は毎回まるごと作り直す作法なので、**最新のマイグレーションだけ**を見る。
 * 古いものには 'client' が残っているが、あとから流れる版が上書きするので問題にしない。
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

function sliceFunctionBody(sql: string, fnName: string): string {
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${fnName}\\b`, 'i').exec(sql)
  if (!head) throw new Error(`${fnName} の定義が見つかりません（切り出せませんでした）`)
  const rest = sql.slice(head.index + head[0].length)
  const next = /create\s+or\s+replace\s+function/i.exec(rest)
  return head[0] + (next ? rest.slice(0, next.index) : rest)
}

/** コメント行を落とす。説明文の中の 'client' を拾って落ちるのを防ぐ */
function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

describe('タスク化が作る決定事項のタスク', () => {
  const FN = '_parse_meeting_minutes_impl'

  it('ボールを相手先にしない', () => {
    const { sql, file } = readLatestMigrationDefining(FN)
    const body = withoutComments(sliceFunctionBody(sql, FN))
    expect(body, `${file} に 'client' が残っている`).not.toContain("'client'")
  })

  it('tasks へ入れるボールが internal になっている', () => {
    const { sql } = readLatestMigrationDefining(FN)
    const body = withoutComments(sliceFunctionBody(sql, FN))
    // 旧来の SPEC 行と、Wiki リンク行の 2 か所
    expect(body).toContain("'considering', 'internal', 'internal', 'spec',")
    expect(body.match(/INSERT INTO tasks \(/g)?.length).toBe(2)
  })

  it('社内側の担当を task_owners に入れる（催促の宛先）', () => {
    const { sql } = readLatestMigrationDefining(FN)
    const body = sliceFunctionBody(sql, FN)
    const inserts = body.match(/INSERT INTO task_owners \(org_id, space_id, task_id, side, user_id\)/g)
    expect(inserts?.length, '2 か所のタスク作成それぞれに要る').toBe(2)
    expect(body).toContain("'internal',\n            COALESCE(v_assignee_id, v_actor_id)")
    expect(body).toContain("'internal',\n                  COALESCE(v_assignee_id, v_actor_id)")
  })

  it('同じ行を二度タスク化しても担当が増えない', () => {
    const { sql } = readLatestMigrationDefining(FN)
    const body = sliceFunctionBody(sql, FN)
    expect(body.match(/ON CONFLICT \(task_id, side, user_id\) DO NOTHING/g)?.length).toBe(2)
  })

  it('ふつうのタスクには担当を入れない（task_create と揃える）', () => {
    const { sql } = readLatestMigrationDefining(FN)
    const body = sliceFunctionBody(sql, FN)
    // Wiki リンク行は spec とふつうのタスクの両方を作るので、担当を入れるのは spec のときだけ
    expect(body).toMatch(/IF v_is_spec THEN\s*\n\s*INSERT INTO task_owners/)
  })
})

describe('催促の宛先の決まり方', () => {
  it('process_spec_decision_nudges が side = ball で宛先を引いている', () => {
    const { sql } = readLatestMigrationDefining('process_spec_decision_nudges')
    expect(sql).toContain('tow.side = tt.ball')
  })
})

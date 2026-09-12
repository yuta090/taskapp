import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * meeting_participants に書き込む SQL が、表に無い列を使っていないかを見張る番人。
 *
 * **なぜ必要か**: 日程調整の確定（rpc_confirm_proposal_slot）は
 * `INSERT INTO meeting_participants (..., created_by)` と書いていたが、表には created_by 列が
 * 無かった（2026-09-12 に本番の表定義で確認）。plpgsql は列の有無を実行するまで確かめないので、
 * マイグレーションは通り、確定した瞬間に本番で落ちる。ユニットテストは DB をモックするので見えない。
 *
 * **見る範囲**: `supabase/migrations/*.sql` を名前順に読み、
 *   - 列の集合 = `create table ... meeting_participants (...)` の列 ＋ `alter table ... add column` − `drop column`
 *   - 書き込み = `insert into meeting_participants (列, ...)` の列の並び（コメント行は除く）
 * 書き込みの列がすべて列の集合に入っていることを確かめる。
 */

const ROOT = path.resolve(__dirname, '../../../..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')
const TABLE = 'meeting_participants'

function readMigrations(): { name: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS)
    // exFAT 上で macOS が作る `._*`（リソースフォーク）はマイグレーションではない
    .filter((f) => f.endsWith('.sql') && !f.startsWith('._'))
    .sort()
    .map((name) => ({
      name,
      // `--` から行末までのコメントを落とす（ロールバック節の書きかけの SQL を拾わない）
      sql: fs.readFileSync(path.join(MIGRATIONS, name), 'utf8').replace(/--[^\n]*/g, ''),
    }))
}

const TABLE_RE = `(?:public\\.)?${TABLE}`

function tableColumns(migrations: { sql: string }[]): Set<string> {
  const cols = new Set<string>()
  for (const { sql } of migrations) {
    const create = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${TABLE_RE}\\s*\\(([\\s\\S]*?)\\n\\s*\\)\\s*;`, 'i').exec(sql)
    if (create) {
      for (const line of create[1].split('\n')) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+\S/i.exec(line)
        if (m && !/^(unique|primary|foreign|constraint|check)$/i.test(m[1])) cols.add(m[1].toLowerCase())
      }
    }
    const alterRe = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${TABLE_RE}\\s+([\\s\\S]*?);`, 'gi')
    for (const alter of sql.matchAll(alterRe)) {
      for (const add of alter[1].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) cols.add(add[1].toLowerCase())
      for (const drop of alter[1].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) cols.delete(drop[1].toLowerCase())
    }
  }
  return cols
}

function insertColumnLists(migrations: { name: string; sql: string }[]): { name: string; columns: string[] }[] {
  const out: { name: string; columns: string[] }[] = []
  const re = new RegExp(`insert\\s+into\\s+${TABLE_RE}\\s*\\(([^)]*)\\)`, 'gi')
  for (const { name, sql } of migrations) {
    for (const m of sql.matchAll(re)) {
      out.push({ name, columns: m[1].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) })
    }
  }
  return out
}

describe('meeting_participants に書き込む SQL の列', () => {
  const migrations = readMigrations()
  const columns = tableColumns(migrations)
  const inserts = insertColumnLists(migrations)

  it('表の定義を読み取れている（番人自体の確認）', () => {
    for (const c of ['id', 'org_id', 'space_id', 'meeting_id', 'user_id', 'side', 'created_at']) {
      expect(columns).toContain(c)
    }
    expect(inserts.length).toBeGreaterThan(0)
  })

  it('書き込みに使う列は、すべて表にある', () => {
    const missing = inserts.flatMap(({ name, columns: cs }) =>
      cs.filter((c) => !columns.has(c)).map((c) => `${name}: ${c}`)
    )
    expect(missing).toEqual([])
  })
})

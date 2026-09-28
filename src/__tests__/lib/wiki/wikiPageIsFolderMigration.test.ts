import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * wiki_pages に「フォルダかどうか」の印(is_folder)を足す migration の回帰。
 *
 * ⚠ このリポジトリには実 PostgreSQL に DDL を流して振る舞いを確かめる基盤が無い
 * （wikiStructureMigration.test.ts と同じ注記）。ここで固定するのは文面ではなく
 * 「壊れると被害が大きく、静かに壊れる」構文上の点だけ。
 */

const migrationsDir = join(process.cwd(), 'supabase/migrations')

// exFAT ボリューム上で macOS が作る AppleDouble(._*) を拾わないよう除外する。
const migrationFiles = readdirSync(migrationsDir).filter(
  (name) => name.endsWith('_wiki_page_is_folder.sql') && !name.startsWith('._')
)

describe('wiki_page_is_folder migration', () => {
  it('ファイルはちょうど1つで、名前は秒精度の14桁で始まる', () => {
    expect(migrationFiles).toHaveLength(1)
    expect(migrationFiles[0]).toMatch(/^\d{14}_wiki_page_is_folder\.sql$/)
  })

  const sql = readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  it('is_folder を not null default false で追加する（冪等）', () => {
    expect(statements).toMatch(/add column if not exists is_folder boolean not null default false/)
  })

  it('RLS ポリシー・GRANT・トリガーは触らない（空間分離を黙って変えない）', () => {
    expect(statements).not.toMatch(/create policy/)
    expect(statements).not.toMatch(/drop policy/)
    expect(statements).not.toMatch(/row level security/)
    expect(statements).not.toMatch(/\bgrant\b/)
    expect(statements).not.toMatch(/create trigger/)
  })
})

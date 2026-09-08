import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * wiki_pages の構造列（親子・マイルストーン・ピン留め・並び順）を足す migration の回帰。
 *
 * ⚠ このリポジトリには実 PostgreSQL に DDL を流して振る舞いを確かめる基盤が無い。
 * そのため「SQL が実際にどう動くか」はここでは検証できない（作成時にローカルの一時
 * PostgreSQL に実際に流して、境界エラー・循環検出・冪等性は手で確認済み）。
 * ここで固定するのは、**壊れると被害が大きく、かつ静かに壊れる**次の点だけ:
 *   1. ファイル名が秒精度（並行ストリームと連番が衝突しない・適用順が一意）
 *   2. 冪等（再適用しても落ちない）
 *   3. 境界検証トリガーが BEFORE INSERT OR UPDATE で張られている
 *      （UPDATE だけだと「消して作り直す」で迂回できる）
 *   4. 親・マイルストーンが org_id と space_id の両方で照合されている
 *      （org だけだと別スペースの親を掴めてしまう）
 *   5. この migration が RLS ポリシーを触っていない（既存の空間分離を黙って変えない）
 */

const migrationsDir = join(process.cwd(), 'supabase/migrations')

// exFAT ボリューム上で macOS が作る AppleDouble(._*) を拾わないよう除外する
// （vitest.config.ts の exclude と同じ理由）。
const migrationFiles = readdirSync(migrationsDir).filter(
  (name) => name.endsWith('_wiki_structure.sql') && !name.startsWith('._')
)

describe('wiki_structure migration', () => {
  it('ファイルはちょうど1つで、名前は秒精度の14桁で始まる', () => {
    expect(migrationFiles).toHaveLength(1)
    expect(migrationFiles[0]).toMatch(/^\d{14}_wiki_structure\.sql$/)
  })

  const sql = readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  // 行コメント(--)は落として見る。解説文に書いてあるだけで通ってしまわないようにするため。
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  it('列追加・索引・トリガーが冪等（再適用しても落ちない）', () => {
    for (const column of ['parent_page_id', 'milestone_id', 'pinned_at', 'sort_order']) {
      expect(statements).toMatch(new RegExp(`add column if not exists ${column}\\b`))
    }
    expect(statements).toMatch(/create index if not exists wiki_pages_parent_idx/)
    expect(statements).toMatch(/create index if not exists wiki_pages_milestone_idx/)
    expect(statements).toMatch(/create or replace function public\.enforce_wiki_page_parent\(\)/)
    expect(statements).toMatch(/drop trigger if exists trg_enforce_wiki_page_parent on public\.wiki_pages/)
  })

  it('親が消えても子は消さない（on delete set null）', () => {
    expect(statements).toMatch(/references public\.wiki_pages\(id\) on delete set null/)
    expect(statements).toMatch(/references public\.milestones\(id\) on delete set null/)
  })

  it('検証トリガーは BEFORE INSERT OR UPDATE で張る（INSERT を素通りさせない）', () => {
    expect(statements).toMatch(/before insert or update on public\.wiki_pages/)
  })

  it('親・マイルストーンを org_id と space_id の両方で照合する', () => {
    expect(statements).toMatch(/new\.org_id/)
    expect(statements).toMatch(/new\.space_id/)
    expect(statements).toMatch(/m\.org_id = new\.org_id/)
    expect(statements).toMatch(/m\.space_id = new\.space_id/)
  })

  it('循環と越境を拒否するエラーを持つ', () => {
    expect(statements).toContain("raise exception 'wiki parent must be in the same space'")
    expect(statements).toContain("raise exception 'wiki parent cycle detected'")
    expect(statements).toContain("raise exception 'wiki milestone must be in the same space'")
  })

  it('祖先の探索に深さ上限があり、上限に達したら通さず拒否する', () => {
    expect(statements).toMatch(/with recursive ancestors as/)
    expect(statements).toMatch(/depth < 50/)
    expect(statements).toContain("raise exception 'wiki parent chain too deep (max 50)'")
  })

  it('関数は security invoker かつ search_path 固定（RLS の中で動かす）', () => {
    expect(statements).toMatch(/security invoker/)
    expect(statements).toMatch(/set search_path = public/)
    expect(statements).not.toMatch(/security definer/)
  })

  it('RLS ポリシーと GRANT は触らない（空間分離を黙って変えない）', () => {
    expect(statements).not.toMatch(/create policy/)
    expect(statements).not.toMatch(/drop policy/)
    expect(statements).not.toMatch(/row level security/)
    expect(statements).not.toMatch(/\bgrant\b/)
  })
})

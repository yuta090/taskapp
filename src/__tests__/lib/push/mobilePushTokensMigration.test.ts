import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * スマホアプリのプッシュ通知の宛先（mobile_push_tokens）と登録 RPC の migration の回帰。
 *
 * ⚠ このリポジトリには実 PostgreSQL に DDL を流して振る舞いを確かめる基盤が無い
 * （wikiPageIsFolderMigration.test.ts と同じ注記）。ここで固定するのは、壊れると
 * 他人の端末に通知が届く・2段階認証を素通りする、といった静かに壊れる点だけ。
 */

const migrationsDir = join(process.cwd(), 'supabase/migrations')
const migrationFiles = readdirSync(migrationsDir).filter(
  (name) => name.endsWith('_mobile_push_tokens.sql') && !name.startsWith('._')
)

describe('mobile_push_tokens migration', () => {
  it('ファイルはちょうど1つで、名前は秒精度の14桁で始まる', () => {
    expect(migrationFiles).toHaveLength(1)
    expect(migrationFiles[0]).toMatch(/^\d{14}_mobile_push_tokens\.sql$/)
  })

  const sql = readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .toLowerCase()

  it('トークンは一意（1台の端末が2人に通知を届けない）', () => {
    expect(statements).toMatch(/token text not null unique/)
  })

  it('RLS を有効にし、自分の行だけ見る・消すポリシーを持つ', () => {
    expect(statements).toMatch(/alter table public\.mobile_push_tokens enable row level security/)
    expect(statements).toMatch(/for select to authenticated using \(user_id = auth\.uid\(\)\)/)
    expect(statements).toMatch(/for delete to authenticated using \(user_id = auth\.uid\(\)\)/)
  })

  it('2段階認証の RESTRICTIVE ポリシーを新しい表にも付ける（既存表向けの一括付与は新しい表に効かない）', () => {
    expect(statements).toMatch(/create policy mfa_required_when_enrolled on public\.mobile_push_tokens\s+as restrictive/)
  })

  it('利用者には select と delete だけ渡す（書き込みは RPC だけ）', () => {
    expect(statements).toMatch(/grant select, delete on table public\.mobile_push_tokens to authenticated/)
    expect(statements).not.toMatch(/grant[^;]*\binsert\b[^;]*mobile_push_tokens/)
    expect(statements).not.toMatch(/grant[^;]*\bupdate\b[^;]*mobile_push_tokens/)
  })

  it('登録 RPC は SECURITY DEFINER なので、中で2段階認証を確かめる（RLS を素通りするため）', () => {
    expect(statements).toMatch(/function public\.rpc_register_mobile_push_token/)
    expect(statements).toMatch(/security definer/)
    expect(statements).toMatch(/set search_path = ''/)
    expect(statements).toMatch(/if not public\.mfa_satisfied\(\) then/)
    expect(statements).toMatch(/if v_uid is null then/)
  })

  it('登録 RPC の実行権は authenticated だけ（作った直後に public/anon から外す）', () => {
    expect(statements).toMatch(
      /revoke all on function public\.rpc_register_mobile_push_token\(text, text, text\) from public, anon, authenticated/
    )
    expect(statements).toMatch(
      /grant execute on function public\.rpc_register_mobile_push_token\(text, text, text\) to authenticated/
    )
  })

  it('同じ端末を別の人が使ったら、前の人の行を消して移す（共有端末で前の人の通知を届けない）', () => {
    expect(statements).toMatch(/delete from public\.mobile_push_tokens where token = p_token and user_id <> v_uid/)
  })
})

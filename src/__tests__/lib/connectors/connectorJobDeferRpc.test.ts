import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * rpc_complete_connector_job の 'defer' 分岐の不変条件を SQL テキストに対して回帰として固定する。
 *
 * ⚠ このリポジトリには実 PostgreSQL に対する統合テストの基盤が無い(DDL を流して振る舞いを確かめる
 * 仕組みが無い)。dispatch/dispatcher のテストは RPC を mock しているため、RPC 自身が「defer で
 * attempt を消費しない」ことは検証できていない。そこで**壊れると静かに大きく壊れる**次を
 * テキストで固定する(mappingDbGuards.test.ts と同じ流儀):
 *   - 'defer' 分岐が attempt を触らない(バックオフ予算を消費しない=無限リトライの回避と両立)。
 *   - 'defer' が status を終端(done/dead)にせず pending のまま lease を解いて 5分後に再試行する。
 *   - シグネチャ(uuid, bigint, text, text)と service_role 限定 EXECUTE・security definer・search_path。
 * 振る舞いそのものの検証は実DB統合テスト基盤ができた時点でそちらへ移すこと。
 */

const migrationsDir = join(process.cwd(), 'supabase/migrations')
const sql = readFileSync(
  join(migrationsDir, '20260723145540_connector_job_defer_outcome.sql'),
  'utf8',
)

/**
 * 'defer' 分岐(elsif p_outcome = 'defer' then ... )の SET 本体だけを切り出す。
 * 行コメント(--)は落とす(解説文の "status='pending'" 等が実行DDLと誤認されないように。
 * 見たいのは実際に実行される SET 句だけ)。
 */
function deferBranch(): string {
  const start = sql.indexOf("p_outcome = 'defer'")
  expect(start).toBeGreaterThan(-1)
  // 次の分岐(else / elsif)の手前までを defer 分岐本体とみなす。
  const rest = sql.slice(start)
  const end = rest.search(/\n\s*(elsif|else)\b/)
  const branch = end === -1 ? rest : rest.slice(0, end)
  return branch
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

describe('rpc_complete_connector_job の defer 分岐(SQLテキスト固定)', () => {
  it('defer 分岐が存在する', () => {
    expect(sql).toMatch(/elsif\s+p_outcome\s*=\s*'defer'\s+then/)
  })

  it('defer は attempt を触らない(バックオフ予算を消費しない=attempt 不変)', () => {
    const branch = deferBranch()
    // SET 句で attempt を代入していないこと(attempt = ... が無い)。
    expect(branch).not.toMatch(/attempt\s*=/)
  })

  it('defer は status を終端化しない(done/dead を書かず pending のまま)', () => {
    const branch = deferBranch()
    expect(branch).not.toMatch(/status\s*=/)
  })

  it('defer は lease を解き next_attempt_at を 5分後に進める', () => {
    const branch = deferBranch()
    expect(branch).toMatch(/leased_until\s*=\s*null/)
    expect(branch).toMatch(/next_attempt_at\s*=\s*now\(\)\s*\+\s*interval\s*'5 minutes'/)
  })

  it('temporary_fail 分岐は従来どおり attempt を +1 する(defer とは別=予算消費が残っている)', () => {
    // defer が temporary_fail の予算消費まで消してしまっていないことの対照。
    expect(sql).toMatch(/attempt\s*=\s*v_attempt\s*\+\s*1/)
  })

  it('シグネチャ(uuid,bigint,text,text)不変・service_role 限定・security definer・search_path 固定', () => {
    expect(sql).toMatch(
      /create or replace function public\.rpc_complete_connector_job\(\s*p_job_id uuid,\s*p_version bigint,\s*p_outcome text,\s*p_error text default null\s*\)/,
    )
    expect(sql).toMatch(/security definer/)
    expect(sql).toMatch(/set search_path = public/)
    expect(sql).toMatch(
      /revoke all on function public\.rpc_complete_connector_job\(uuid, bigint, text, text\) from public, anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.rpc_complete_connector_job\(uuid, bigint, text, text\) to service_role/,
    )
  })
})

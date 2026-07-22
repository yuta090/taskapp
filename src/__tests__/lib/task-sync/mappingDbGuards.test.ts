import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IMPORT_CONFIG_SERVER_MANAGED_KEYS } from '@/lib/integrations/importConfig'

/**
 * マッピング保護のDB側不変条件を、SQLのテキストに対して回帰として固定する。
 *
 * ⚠ このリポジトリには実PostgreSQLに対する統合テストの基盤が無い（DDLを流して振る舞いを確かめる
 * 仕組みが無い）。そのため「SQLが実際にどう振る舞うか」はここでは検証できない。
 * 代わりに、**壊れると被害が大きく、かつ静かに壊れる**次の3点だけをテキストで固定する:
 *   1. mappings のガードトリガーが BEFORE INSERT OR UPDATE で張られていること
 *      （UPDATE だけだと「削除して作り直す」で迂回できる）
 *   2. TS と SQL の「サーバ管理フィールド」一覧が一致していること（片方だけ増やすと穴が開く）
 *   3. kintone RPC の app_id 再確認が行ロック取得(for update)の**後**にあること
 *      （前にあると TOCTOU が塞がらない）
 * 振る舞いそのものの検証は、実DBに対する統合テスト基盤ができた時点でそちらへ移すこと。
 */

const migrationsDir = join(process.cwd(), 'supabase/migrations')
const read = (name: string) => readFileSync(join(migrationsDir, name), 'utf8')

describe('integration_connections mappings ガードトリガー', () => {
  const sql = read('20260722233606_protect_task_sync_mappings.sql')

  it('BEFORE INSERT OR UPDATE で張る（UPDATEだけだと削除→再作成で迂回できる）', () => {
    expect(sql).toMatch(/before insert or update on public\.integration_connections/)
  })

  it('notion_mappings / kintone_mappings の両方をガードする', () => {
    expect(sql).toContain("'notion_mappings'")
    expect(sql).toContain("'kintone_mappings'")
  })

  /**
   * ロール判定は既存2系統(auth.role() / current_setting('role')) の OR。
   * 片方だけにすると、もう一方の系統しか成立しない経路で正当な書込まで止まる。
   */
  it('service_role の判定は既存2系統の OR で行う', () => {
    expect(sql).toMatch(/auth\.role\(\) = 'service_role'\s+or current_setting\('role', true\) = 'service_role'/)
  })

  /**
   * 「変更していない UPDATE は素通し」が無いと、トークンリフレッシュ等の既存の正当な更新が
   * 巻き添えで落ちる（既存データに不正なマッピングが残っている行で特に危険）。
   */
  it('mappings を変更しない UPDATE は素通しする（既存の正当な更新経路を壊さない）', () => {
    expect(sql).toMatch(/is not distinct from old\.import_config/)
    expect(sql).toMatch(/is distinct from \(old\.import_config -> 'notion_mappings'\)/)
    expect(sql).toMatch(/is distinct from \(old\.import_config -> 'kintone_mappings'\)/)
  })
})

describe('rpc_import_config_merge（汎用PATCHの部分更新）', () => {
  const sql = read('20260722233711_import_config_merge_rpc.sql')

  it('TS の IMPORT_CONFIG_SERVER_MANAGED_KEYS と SQL の c_server_managed_keys が一致する', () => {
    const m = sql.match(/c_server_managed_keys constant text\[\] := array\[([^\]]+)\]/)
    expect(m).not.toBeNull()
    const sqlKeys = m![1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
    expect(sqlKeys).toEqual([...IMPORT_CONFIG_SERVER_MANAGED_KEYS])
  })

  it('行ロック(for update)を取ってから書く（lost update を構造的に防ぐ）', () => {
    expect(sql).toMatch(/for update;/)
  })

  it('security definer + search_path 固定 + EXECUTE は service_role のみ', () => {
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(/revoke all on function public\.rpc_import_config_merge\(uuid, jsonb, boolean\) from public, anon, authenticated;/)
    expect(sql).toMatch(/grant execute on function public\.rpc_import_config_merge\(uuid, jsonb, boolean\) to service_role;/)
  })
})

describe('rpc_kintone_mapping_merge の app_id 再確認（TOCTOU）', () => {
  const sql = read('20260722230447_kintone_mapping_merge_rpc.sql')

  it('app_id の再確認は for update の後にある（前だと TOCTOU が塞がらない）', () => {
    const lockAt = sql.indexOf('for update;')
    const recheckAt = sql.indexOf('is not registered in import_config.kintone_app_ids')
    expect(lockAt).toBeGreaterThan(-1)
    expect(recheckAt).toBeGreaterThan(lockAt)
  })

  /**
   * 正規化の意味を normalizeKintoneAppIds(TS) と揃える: JSON の文字列と数値の双方を同じ意味で扱う。
   * 揃っていないと「アプリ側では登録済みなのにRPCが拒否する」食い違いが起きる。
   */
  it('kintone_app_ids の要素は string と number の双方を同じ意味で比較する', () => {
    expect(sql).toMatch(/jsonb_typeof\(e\.v\) in \('string', 'number'\)/)
    expect(sql).toMatch(/e\.v #>> '\{\}' = p_app_id/)
  })

  it('未登録は 22023(設定破損)と別の errcode にする（APIが別メッセージ・別ステータスへ写像するため）', () => {
    expect(sql).toMatch(/is not registered in import_config\.kintone_app_ids'[\s\S]{0,80}errcode = 'KTAPP'/)
  })
})

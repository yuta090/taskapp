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
 *   1. ガードトリガーが BEFORE INSERT OR UPDATE で張られ、その本体が保護すべきキー
 *      （notion_mappings / kintone_mappings に加え、kintone のアプリ資格情報
 *       kintone_app_tokens / kintone_app_ids）を全て見ていること
 *      （UPDATE だけだと「削除して作り直す」で迂回でき、キーが漏れると静かに穴が開く）
 *   2. TS と SQL の「サーバ管理フィールド」一覧が一致していること（片方だけ増やすと穴が開く）
 *   3. kintone RPC の app_id 再確認が行ロック取得(for update)の**後**にあること
 *      （前にあると TOCTOU が塞がらない）
 * 振る舞いそのものの検証は、実DBに対する統合テスト基盤ができた時点でそちらへ移すこと。
 */

const migrationsDir = join(process.cwd(), 'supabase/migrations')
const read = (name: string) => readFileSync(join(migrationsDir, name), 'utf8')

describe('integration_connections ガードトリガーの張り方（トリガー定義の正本）', () => {
  // ⚠ トリガー(create trigger)の定義はこのファイルのままだが、**関数本体は
  // 20260723022033_guard_kintone_app_credentials.sql が create or replace で差し替えている**
  // (保護対象キーに kintone_app_tokens / kintone_app_ids を追加するため。関数の OID は保持され
  // るのでトリガーは張り替えていない)。そのため本体の不変条件は下の describe(新ファイル)で
  // 固定し、ここではトリガーの張り方だけを固定する
  // (rpc_import_config_merge と同じ扱い＝現在有効な定義ファイルを読むこと)。
  const sql = read('20260722233606_protect_task_sync_mappings.sql')

  it('BEFORE INSERT OR UPDATE で張る（UPDATEだけだと削除→再作成で迂回できる）', () => {
    expect(sql).toMatch(/before insert or update on public\.integration_connections/)
  })
})

describe('integration_connections ガードトリガーの本体（現在有効な定義）', () => {
  const sql = read('20260723022033_guard_kintone_app_credentials.sql')

  /**
   * 関数名を変えると本番で稼働中のトリガー定義との対応が切れ、張り替え（＝ガードが外れる一瞬）が
   * 必要になる。差し替えは create or replace で行い、トリガーは作り直さないことを固定する。
   */
  it('関数は create or replace で差し替え、トリガーは作り直さない', () => {
    expect(sql).toMatch(/create or replace function public\.integration_connections_guard_mappings\(\)/)
    // 行コメント(--)を落としてから見る。ヘッダの解説文に「drop/create trigger は不要」と
    // 書いてあるだけで落ちないようにするため（見たいのは実際に実行されるDDLだけ）。
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    expect(statements).not.toMatch(/create trigger/)
    expect(statements).not.toMatch(/drop trigger/)
  })

  it('notion_mappings / kintone_mappings をガードする（既存の保護範囲を落とさない）', () => {
    expect(sql).toContain("'notion_mappings'")
    expect(sql).toContain("'kintone_mappings'")
  })

  /**
   * kintone_app_tokens は「どのトークンがどのアプリのものか」の正本（access_token_encrypted は
   * ここから再計算される派生キャッシュ）、kintone_app_ids は取り込み対象アプリの正本。
   * マッピングより機微なので、同じ理由で service_role 以外から書けないようにする。
   */
  it('kintone_app_tokens / kintone_app_ids も保護対象に含む', () => {
    expect(sql).toContain("'kintone_app_tokens'")
    expect(sql).toContain("'kintone_app_ids'")
  })

  /**
   * ロール判定は既存2系統(auth.role() / current_setting('role')) の OR のまま。
   * 片方だけにすると、もう一方の系統しか成立しない経路で正当な書込まで止まる。
   */
  it('service_role の判定は既存2系統の OR のまま', () => {
    expect(sql).toMatch(/auth\.role\(\) = 'service_role'\s+or current_setting\('role', true\) = 'service_role'/)
  })

  /**
   * 「変更していない UPDATE は素通し」が無いと、トークンリフレッシュ・saveCursor 等の既存の
   * 正当な更新が巻き添えで落ちる（既存データに不正な値が残っている行で特に危険）。
   */
  it('保護対象キーを変更しない UPDATE は素通しする（既存の正当な更新経路を壊さない）', () => {
    expect(sql).toMatch(/is not distinct from old\.import_config/)
    expect(sql).toMatch(/is distinct from \(old\.import_config -> 'notion_mappings'\)/)
    expect(sql).toMatch(/is distinct from \(old\.import_config -> 'kintone_mappings'\)/)
    expect(sql).toMatch(/is distinct from \(old\.import_config -> 'kintone_app_tokens'\)/)
    expect(sql).toMatch(/is distinct from \(old\.import_config -> 'kintone_app_ids'\)/)
  })

  /**
   * UPDATE だけ塞ぐと「削除して作り直す」で同じ注入ができるため、INSERT でもこれらのキーを
   * 含む行を拒否する。tg_op='INSERT' ブロックの中に4キー全ての存在チェックがあることを見る。
   */
  it('INSERT でも4キーすべてを含む行を拒否する（削除→再作成での迂回を塞ぐ）', () => {
    const insertBlock = sql.slice(sql.indexOf("if tg_op = 'INSERT' then"), sql.indexOf('-- UPDATE:'))
    expect(insertBlock).not.toBe('')
    for (const key of ['notion_mappings', 'kintone_mappings', 'kintone_app_tokens', 'kintone_app_ids']) {
      expect(insertBlock).toMatch(
        new RegExp(`\\(new\\.import_config -> '${key}'\\) is not null`),
      )
    }
  })

  /**
   * TS 側のサーバ管理キー一覧（汎用PATCHが落とすキー）と、DBガードが守るキーが食い違うと、
   * 「アプリ層では落とすのにDBでは素通し」（またはその逆）の穴が静かに生まれる。
   */
  it('TS の IMPORT_CONFIG_SERVER_MANAGED_KEYS 全てをガードする', () => {
    for (const key of IMPORT_CONFIG_SERVER_MANAGED_KEYS) {
      expect(sql).toContain(`'${key}'`)
    }
  })
})

describe('rpc_import_config_merge（汎用PATCHの部分更新）', () => {
  // ⚠ この関数は 20260723014852_kintone_apps_merge_rpc.sql で create or replace により
  // 再定義されている(kintone_app_tokens をサーバ管理フィールドに追加するため)。シグネチャは
  // 不変なので旧ファイル(20260722233711_import_config_merge_rpc.sql)の本体・grant/revoke宣言は
  // 歴史的記録として残るが、**現在有効な定義は新ファイル側**であるため、この不変条件テストは
  // 新ファイルを読む(再定義のたびにこのテストも最新の定義ファイルを指すよう更新すること)。
  const sql = read('20260723014852_kintone_apps_merge_rpc.sql')

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

describe('rpc_kintone_apps_add / rpc_kintone_apps_remove（アプリの追加・削除。トークン対応の保持）', () => {
  const sql = read('20260723014852_kintone_apps_merge_rpc.sql')

  it('行ロック(for update)を取ってから読み書きする（追加・削除どちらも）', () => {
    const occurrences = sql.match(/for update;/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
  })

  it('security definer + search_path 固定 + EXECUTE は service_role のみ（追加・削除どちらも）', () => {
    expect(sql).toMatch(
      /revoke all on function public\.rpc_kintone_apps_add\(uuid, uuid, text, text, text\) from public, anon, authenticated;/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.rpc_kintone_apps_add\(uuid, uuid, text, text, text\) to service_role;/,
    )
    expect(sql).toMatch(
      /revoke all on function public\.rpc_kintone_apps_remove\(uuid, uuid, text, text\) from public, anon, authenticated;/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.rpc_kintone_apps_remove\(uuid, uuid, text, text\) to service_role;/,
    )
  })

  /**
   * ⚠ トークン対応の保持方式(実装ランナーへの委任事項): kintone_app_tokens(app_idをキーにした
   * 個別暗号化トークンのjsonbオブジェクト)を正本とし、access_token_encrypted(カンマ結合の
   * 複合blob)はここから都度再計算する派生キャッシュとする。復号→再結合→再暗号化は
   * decrypt_system_secret/encrypt_system_secretを直接呼び、行ロックの内側(Node側の
   * 読み書き分離ではなくDB側で完結)で行う。
   */
  it('kintone_app_tokensを正本とし、access_token_encryptedを都度再計算する(復号→結合→再暗号化)', () => {
    expect(sql).toContain("v_config -> 'kintone_app_tokens'")
    expect(sql).toMatch(/public\.decrypt_system_secret\(/)
    expect(sql).toMatch(/public\.encrypt_system_secret\(/)
    expect(sql).toContain('access_token_encrypted = v_new_combined_encrypted')
  })

  it('追加時: 重複登録(KTDUP)・9件上限(KT9MX)を行ロック後に再確認する(TOCTOU対策)', () => {
    const lockAt = sql.indexOf('for update;')
    const dupAt = sql.indexOf("errcode = 'KTDUP'")
    const maxAt = sql.indexOf("errcode = 'KT9MX'")
    expect(lockAt).toBeGreaterThan(-1)
    expect(dupAt).toBeGreaterThan(lockAt)
    expect(maxAt).toBeGreaterThan(lockAt)
  })

  it('kintone_app_tokensに対応が無い登録済みapp_idが見つかったら、位置推測せずKTGAPで失敗する', () => {
    const occurrences = sql.match(/errcode = 'KTGAP'/g) ?? []
    // 追加(add)・削除(remove)の両方でギャップチェックを行う。
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
  })

  it('削除時: 未登録(KTNF)・最後の1アプリ(KTLAST)を拒否する', () => {
    expect(sql).toMatch(/errcode = 'KTNF'/)
    expect(sql).toMatch(/errcode = 'KTLAST'/)
    expect(sql).toMatch(/cannot remove the last remaining app/)
  })

  it('削除はkintone_mappings[app_id]を消さない(判断: Notionと同様に確定済み設定は残す)', () => {
    expect(sql).not.toMatch(/kintone_mappings.*-\s*p_app_id/)
    expect(sql).toContain('ここでは触らない(削除しない)')
  })
})

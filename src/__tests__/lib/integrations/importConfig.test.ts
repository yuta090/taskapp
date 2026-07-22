import { describe, it, expect } from 'vitest'
import { sanitizeImportConfigForClient } from '@/lib/integrations/importConfig'

/**
 * sanitizeImportConfigForClient — import_config をAPI応答としてクライアントへ返す前に
 * 必ず通すサニタイザ（Codexレビュー指摘: kintone_app_tokens が接続一覧・取り込み設定PATCHの
 * 応答にそのまま載ってブラウザ・React Queryキャッシュ・devtoolsへ流出していた）。
 *
 * ⚠ 「サーバ管理キー」(IMPORT_CONFIG_SERVER_MANAGED_KEYS: クライアントから**書けない**が、
 * **表示は必要**なキー。kintone_app_ids はUIが一覧を描く正本、kintone_mappings/notion_mappings は
 * 「設定済み/未設定」バッジの正本)と、「クライアント非公開キー」(暗号化された秘密そのもの。
 * 復号鍵が万一漏れた場合のオラクル攻撃の温床になるため、ブラウザには一切出してはならない)は
 * 別概念。IMPORT_CONFIG_SERVER_MANAGED_KEYS を流用して両方消すとUIの「設定済み/未設定」バッジ・
 * アプリ一覧が壊れるため、非公開キーは別のリストで持つ。
 */
describe('sanitizeImportConfigForClient', () => {
  it('kintone_app_tokens(アプリ単位の暗号化APIトークン)は取り除く', () => {
    const result = sanitizeImportConfigForClient({
      target_space_id: 'space-1',
      kintone_app_ids: ['5', '9'],
      kintone_app_tokens: { '5': 'enc(token-5)', '9': 'enc(token-9)' },
    })
    expect(result).not.toHaveProperty('kintone_app_tokens')
  })

  it('kintone_app_ids(取り込み対象アプリの正本。UIの一覧描画に使う)は残す', () => {
    const result = sanitizeImportConfigForClient({
      kintone_app_ids: ['5', '9'],
      kintone_app_tokens: { '5': 'enc(token-5)' },
    })
    expect(result.kintone_app_ids).toEqual(['5', '9'])
  })

  it('kintone_mappings(設定済み/未設定バッジの正本)は残す', () => {
    const mappings = { '5': { title_field_code: 'title', due_field_code: null, status: null, confirmed_at: '2026-07-01T00:00:00.000Z' } }
    const result = sanitizeImportConfigForClient({ kintone_mappings: mappings })
    expect(result.kintone_mappings).toEqual(mappings)
  })

  it('notion_mappingsも同様に残す(kintone専用のサニタイズにしない)', () => {
    const mappings = { 'db-1': { due_prop_id: 'p1', status: null, confirmed_at: '2026-07-01T00:00:00.000Z' } }
    const result = sanitizeImportConfigForClient({ notion_mappings: mappings })
    expect(result.notion_mappings).toEqual(mappings)
  })

  it('その他の可視設定(target_space_id等)はそのまま残す', () => {
    const result = sanitizeImportConfigForClient({
      target_space_id: 'space-1',
      read_container_ids: ['c1'],
      default_assignee_id: 'user-1',
    })
    expect(result).toEqual({
      target_space_id: 'space-1',
      read_container_ids: ['c1'],
      default_assignee_id: 'user-1',
    })
  })

  it('null/undefined/非object入力は空オブジェクトに倒す(呼び出し側で例外を出さない)', () => {
    expect(sanitizeImportConfigForClient(null)).toEqual({})
    expect(sanitizeImportConfigForClient(undefined)).toEqual({})
  })

  it('元のオブジェクトを破壊しない(呼び出し側の入力を変更しない)', () => {
    const original = { kintone_app_tokens: { '5': 'enc' }, target_space_id: 's1' }
    const snapshot = JSON.parse(JSON.stringify(original))
    sanitizeImportConfigForClient(original)
    expect(original).toEqual(snapshot)
  })
})

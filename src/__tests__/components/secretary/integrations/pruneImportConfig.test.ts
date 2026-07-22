import { describe, it, expect } from 'vitest'
import { pruneImportConfig } from '@/lib/integrations/importConfig'

/**
 * pruneImportConfig — import_config の空文字/空配列キーを送らない(≒未設定)ための整形関数。
 *
 * ⚠ read_container_ids だけは特別扱いが要る。サーバ側(import-config/route.tsのPATCH)は
 * 「キー自体が無ければ現在値を保持、キーがあれば(空配列でも)その値で上書きする」という部分更新
 * セマンティクスを持つ。read_container_ids を他のキーと同じく空配列で削除してしまうと、
 * 「全解除したい(空配列で送る)」という意図が「キーを送らなかった(現在値を維持)」に化けてしまい、
 * 取り込み対象から外す操作が反映されない罠になる（本テストが固定する回帰）。
 * 他のキー(target_space_id/read_list_ids/default_assignee_id等)は空文字/空配列＝未設定という
 * 契約のままなので、従来どおり削除されなければならない。
 */
describe('pruneImportConfig', () => {
  it('read_container_ids の空配列は削除せず保持する(全解除の意図を送れる)', () => {
    const result = pruneImportConfig({ target_space_id: 'space-1', read_container_ids: [] })
    expect(result).toHaveProperty('read_container_ids')
    expect(result.read_container_ids).toEqual([])
  })

  it('read_container_ids に値がある場合はそのまま保持する', () => {
    const result = pruneImportConfig({ read_container_ids: ['db-1', 'db-2'] })
    expect(result.read_container_ids).toEqual(['db-1', 'db-2'])
  })

  it('read_list_ids(gtasks)の空配列は従来どおり削除する', () => {
    const result = pruneImportConfig({ target_space_id: 'space-1', read_list_ids: [] })
    expect(result).not.toHaveProperty('read_list_ids')
  })

  it('空文字のtarget_space_idは従来どおり削除する', () => {
    const result = pruneImportConfig({ target_space_id: '', read_container_ids: [] })
    expect(result).not.toHaveProperty('target_space_id')
    expect(result).toHaveProperty('read_container_ids')
  })

  it('undefinedのキーは従来どおり削除する', () => {
    const result = pruneImportConfig({ default_assignee_id: undefined, read_container_ids: [] })
    expect(result).not.toHaveProperty('default_assignee_id')
  })

  it('read_container_ids自体が無ければ何も足さない', () => {
    const result = pruneImportConfig({ target_space_id: 'space-1' })
    expect(result).not.toHaveProperty('read_container_ids')
    expect(result).toEqual({ target_space_id: 'space-1' })
  })
})

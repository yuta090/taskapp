import { describe, it, expect } from 'vitest'
import { normalizeImportConfigPatch } from '@/lib/integrations/importConfig'

/**
 * normalizeImportConfigPatch（旧 pruneImportConfig）— import_config の PATCH ペイロード整形。
 *
 * サーバ側は部分更新(rpc_import_config_merge)になった:
 *   - 送ったキーだけ更新 / 送らなかったキーは現在値のまま / 値が null のキーは削除(未設定)
 * そのため「空文字・空配列＝未設定」は **キーを削除して送る** のではなく **null を送る** で表す。
 * 旧方式(削除)のままだと「未設定にしたい」が「現在値を維持」に化け、解除操作が永久に反映されない。
 *
 * ⚠ read_container_ids だけは特別扱いが要る。「取り込み対象を全解除したい」は未設定(null)ではなく
 * 「空配列という値」で表す契約であり、null に倒すとキーごと消えて絞り込み解除の意味が変わる。
 */
describe('normalizeImportConfigPatch', () => {
  it('read_container_ids の空配列は null にせず値として保持する(全解除の意図を送れる)', () => {
    const result = normalizeImportConfigPatch({ target_space_id: 'space-1', read_container_ids: [] })
    expect(result.read_container_ids).toEqual([])
  })

  it('read_container_ids に値がある場合はそのまま保持する', () => {
    const result = normalizeImportConfigPatch({ read_container_ids: ['db-1', 'db-2'] })
    expect(result.read_container_ids).toEqual(['db-1', 'db-2'])
  })

  it('read_list_ids(gtasks)の空配列は null(未設定)にする', () => {
    const result = normalizeImportConfigPatch({ target_space_id: 'space-1', read_list_ids: [] })
    expect(result).toHaveProperty('read_list_ids')
    expect(result.read_list_ids).toBeNull()
  })

  it('空文字のtarget_space_idは null(未設定)にする', () => {
    const result = normalizeImportConfigPatch({ target_space_id: '', read_container_ids: [] })
    expect(result.target_space_id).toBeNull()
    expect(result.read_container_ids).toEqual([])
  })

  /**
   * undefined を「キーを消して送らない」にすると、部分更新では現在値維持に化けて未設定にできない。
   * JSON.stringify でも消えてしまうため、明示的な null へ倒す必要がある（この回帰を固定する）。
   */
  it('undefinedのキーは null(未設定)にする（送らない＝現在値維持 に化けさせない）', () => {
    const result = normalizeImportConfigPatch({ default_assignee_id: undefined, read_container_ids: [] })
    expect(result).toHaveProperty('default_assignee_id')
    expect(result.default_assignee_id).toBeNull()
    expect(JSON.parse(JSON.stringify(result))).toHaveProperty('default_assignee_id', null)
  })

  it('read_container_ids自体が無ければ何も足さない', () => {
    const result = normalizeImportConfigPatch({ target_space_id: 'space-1' })
    expect(result).not.toHaveProperty('read_container_ids')
    expect(result).toEqual({ target_space_id: 'space-1' })
  })
})

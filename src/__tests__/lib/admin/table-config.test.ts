import { describe, it, expect } from 'vitest'
import { ALLOWED_TABLES, TABLE_LABELS, TABLE_CATEGORIES, isAllowedTable } from '@/lib/admin/table-config'

describe('table-config', () => {
  it('auth_event_logs をテーブル一覧で開ける（ラベル・カテゴリも揃っている）', () => {
    expect(isAllowedTable('auth_event_logs')).toBe(true)
    expect(TABLE_LABELS.auth_event_logs).toBe('ログイン失敗ログ')
    const inCategory = TABLE_CATEGORIES.some((c) => c.tables.includes('auth_event_logs'))
    expect(inCategory).toBe(true)
  })

  it('許可テーブルは全てラベルを持つ', () => {
    for (const t of ALLOWED_TABLES) {
      expect(TABLE_LABELS[t], t).toBeTruthy()
    }
  })
})

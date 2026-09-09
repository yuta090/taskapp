import { describe, it, expect } from 'vitest'
import { getSettingsCategories } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/settingsNav'
import type { SettingSectionId } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/types'

function findItem(categories: ReturnType<typeof getSettingsCategories>, id: SettingSectionId) {
  for (const category of categories) {
    const item = category.items.find((i) => i.id === id)
    if (item) return { ...item, categoryId: category.id }
  }
  return undefined
}

describe('プロジェクト設定のメニュー', () => {
  it('管理者には「危険設定」が「データ管理」の中に出る', () => {
    const item = findItem(getSettingsCategories({ isAdmin: true }), 'danger')

    expect(item?.label).toBe('危険設定')
    expect(item?.categoryId).toBe('data')
  })

  it('管理者以外には「危険設定」を出さない', () => {
    expect(findItem(getSettingsCategories({ isAdmin: false }), 'danger')).toBeUndefined()
  })

  it('基本設定は管理者でなくても出る', () => {
    expect(findItem(getSettingsCategories({ isAdmin: false }), 'general')).toBeDefined()
  })
})

import { describe, it, expect } from 'vitest'
import { matchesTaskSearch } from '@/lib/tasks/taskSearch'

const task = (over: Partial<{ title: string; description: string | null; short_id: number | null }> = {}) => ({
  title: '見積書を作る',
  description: '先方に送る',
  short_id: 42,
  ...over,
})

describe('matchesTaskSearch', () => {
  it('タイトル・説明の部分一致で見つかる', () => {
    expect(matchesTaskSearch(task(), '見積')).toBe(true)
    expect(matchesTaskSearch(task(), '先方')).toBe(true)
    expect(matchesTaskSearch(task(), '請求')).toBe(false)
  })

  it('画面に出ている「TP-42」で見つかる（大文字小文字・ハイフン・空白・# は問わない）', () => {
    for (const q of ['TP-42', 'tp-42', 'TP42', 'tp 42', '#42', '42', ' TP-42 ']) {
      expect(matchesTaskSearch(task(), q)).toBe(true)
    }
  })

  it('番号は完全一致（TP-4 で TP-42 は出ない）', () => {
    expect(matchesTaskSearch(task(), 'TP-4')).toBe(false)
    expect(matchesTaskSearch(task({ short_id: 4 }), 'TP-4')).toBe(true)
  })

  it('数字だけでもタイトルの部分一致は残す', () => {
    expect(matchesTaskSearch(task({ title: '2026年度の計画', short_id: 1 }), '2026')).toBe(true)
  })

  it('採番前（short_id が無い）のタスクも落ちない', () => {
    expect(matchesTaskSearch(task({ short_id: null }), 'TP-42')).toBe(false)
    expect(matchesTaskSearch(task({ short_id: null }), '見積')).toBe(true)
  })

  it('空の検索語はすべて通す', () => {
    expect(matchesTaskSearch(task(), '  ')).toBe(true)
  })
})

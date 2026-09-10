import { describe, it, expect } from 'vitest'
import { formatTaskNumber, TASK_NUMBER_PREFIX } from '@/lib/tasks/taskNumber'

/**
 * tasks.short_id（サービス全体の通し番号）を画面/CLIに表示するための整形関数。
 * GitHub連携(task-linker.ts)の `TP-` プレフィックスと同じものをここで一元管理する。
 */
describe('formatTaskNumber', () => {
  it('short_id を TP-<番号> の形に整形する', () => {
    expect(formatTaskNumber(42)).toBe('TP-42')
  })

  it('ゼロ埋めはしない', () => {
    expect(formatTaskNumber(7)).toBe('TP-7')
  })

  it('null は null を返す', () => {
    expect(formatTaskNumber(null)).toBeNull()
  })

  it('undefined は null を返す', () => {
    expect(formatTaskNumber(undefined)).toBeNull()
  })

  it('プレフィックス定数は TP', () => {
    expect(TASK_NUMBER_PREFIX).toBe('TP')
  })
})

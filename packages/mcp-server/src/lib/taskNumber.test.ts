import { describe, it, expect } from 'vitest'
import { formatTaskNumber, withTaskNumber, TASK_NUMBER_PREFIX } from './taskNumber.js'

describe('formatTaskNumber', () => {
  it('short_id を TP-<番号> に整形する', () => {
    expect(formatTaskNumber(42)).toBe('TP-42')
  })

  it('null/undefined は null を返す', () => {
    expect(formatTaskNumber(null)).toBeNull()
    expect(formatTaskNumber(undefined)).toBeNull()
  })

  it('プレフィックスは TP', () => {
    expect(TASK_NUMBER_PREFIX).toBe('TP')
  })
})

describe('withTaskNumber', () => {
  it('number を先頭キーにし、他の値は変えない', () => {
    const row = { id: 't-1', org_id: 'o1', space_id: 's1', title: 'x', status: 'todo', ball: 'internal', due_date: null, short_id: 7, extra: 'keep' }
    const result = withTaskNumber(row)
    expect(Object.keys(result)[0]).toBe('number')
    expect(result.number).toBe('TP-7')
    expect(result.id).toBe('t-1')
    expect(result.extra).toBe('keep')
  })

  it('short_id が null なら number は null', () => {
    const row = { id: 't-1', short_id: null }
    const result = withTaskNumber(row)
    expect(result.number).toBeNull()
  })
})

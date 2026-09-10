import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { output } from './output.js'

/**
 * printTable は「先頭8列だけ」を表に出す（キーの並び順で先頭から選ぶ）。task_list/task_get が
 * 足す number(TP-番号) を末尾に置くと8列目からはみ出て見えなくなるため、mcp-server 側
 * (packages/mcp-server/src/lib/taskNumber.ts の withTaskNumber)で number を各タスク行の
 * 先頭キーにしている。ここではその前提(先頭キー→表の先頭列)が output.ts 側で保たれることを確かめる。
 */

// withTaskNumber と同じ並び(number → title → status → ball → due_date → id → org_id → space_id → ...)
function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    number: 'TP-42',
    title: 'サンプルタスク',
    status: 'todo',
    ball: 'internal',
    due_date: '2026-09-10',
    id: 't-1',
    org_id: 'org-1',
    space_id: 'space-1',
    milestone_id: null,
    ...overrides,
  }
}

describe('output — タスク一覧の表表示は number(TP-番号) を先頭列にする', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('表のヘッダー行で number が title・status より先に出る', () => {
    output([taskRow()], false)
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    const numberIdx = printed.indexOf('number')
    const titleIdx = printed.indexOf('title')
    const statusIdx = printed.indexOf('status')
    expect(numberIdx).toBeGreaterThanOrEqual(0)
    expect(numberIdx).toBeLessThan(titleIdx)
    expect(titleIdx).toBeLessThan(statusIdx)
  })

  it('各行のセルに TP-42 が出る', () => {
    output([taskRow()], false)
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('TP-42')
  })

  it('--json モードでは number の値だけが増え、他の値は変わらない', () => {
    const row = taskRow()
    output([row], true)
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    const parsed = JSON.parse(printed)
    expect(parsed[0]).toEqual(row)
  })
})

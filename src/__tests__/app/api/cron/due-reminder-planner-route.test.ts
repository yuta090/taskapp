import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/due-reminder-planner（設計正本 §6.1・PR-1）
 *
 * - Bearer CRON_SECRET 必須
 * - entitlement-blind（課金プランを一切見ない）
 * - 対象タスクから occurrence draft を作り on conflict do nothing で materialize する
 */

const storeMock = {
  findDueReminderCandidateTasks: vi.fn(),
  materializeDueReminderOccurrences: vi.fn(),
}
vi.mock('@/lib/reminders/dueReminderStore', () => storeMock)

const { POST } = await import('@/app/api/cron/due-reminder-planner/route')

function callPost(headers: Record<string, string> = { authorization: 'Bearer test-cron-secret' }) {
  const request = new NextRequest(new URL('/api/cron/due-reminder-planner', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
  return POST(request)
}

describe('POST /api/cron/due-reminder-planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([])
    storeMock.materializeDueReminderOccurrences.mockResolvedValue(0)
  })

  it('CRON_SECRET未設定は500', async () => {
    delete process.env.CRON_SECRET
    const res = await callPost({ authorization: 'Bearer anything' })
    expect(res.status).toBe(500)
  })

  it('Authorizationヘッダ不正は401', async () => {
    const res = await callPost({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
    expect(storeMock.findDueReminderCandidateTasks).not.toHaveBeenCalled()
  })

  it('候補0件ならmaterializeを空配列で呼び0件で200', async () => {
    const res = await callPost()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ candidates: 0, drafts: 0, materialized: 0 })
    expect(storeMock.materializeDueReminderOccurrences).toHaveBeenCalledWith([])
  })

  it('対象タスクからoccurrence draftを作りmaterializeする', async () => {
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([
      { id: 't-1', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-1' },
    ])
    storeMock.materializeDueReminderOccurrences.mockResolvedValue(3)

    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ candidates: 1, drafts: 3, materialized: 3 })
    const draftsArg = storeMock.materializeDueReminderOccurrences.mock.calls[0][0]
    expect(draftsArg).toHaveLength(3)
    expect(draftsArg.every((d: { taskId: string }) => d.taskId === 't-1')).toBe(true)
  })

  it('assignee無/done/due無のタスクはdraftが作られない（isDueReminderEligibleの回帰）', async () => {
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([
      { id: 'no-assignee', dueDate: '2999-01-01', status: 'todo', assigneeId: null },
      { id: 'done', dueDate: '2999-01-01', status: 'done', assigneeId: 'u-1' },
      { id: 'no-due', dueDate: null, status: 'todo', assigneeId: 'u-1' },
    ])

    const res = await callPost()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.drafts).toBe(0)
  })

  it('grace超過(過去期限一斉送信防止)の候補はdraftが作られない', async () => {
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([
      { id: 't-old', dueDate: '2000-01-01', status: 'todo', assigneeId: 'u-1' },
    ])
    const res = await callPost()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.drafts).toBe(0)
  })

  it('materializeが失敗したら500・エラー内容を返す', async () => {
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([
      { id: 't-1', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-1' },
    ])
    storeMock.materializeDueReminderOccurrences.mockRejectedValue(new Error('db down'))

    const res = await callPost()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('materialize_failed')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/due-reminder-planner（設計正本 §6.1・PR-1・うざくない秘書 再設計）
 *
 * - Bearer CRON_SECRET 必須
 * - entitlement-blind（課金プランを一切見ない）
 * - 対象タスクから occurrence draft を作り on conflict do nothing で materialize する
 * - org単位の自動期限リマインドオンオフ(org_channel_policy.due_reminders_enabled・§2)は
 *   entitlementとは別に判定し、offのorgは新規occurrenceを作らない
 */

const storeMock = {
  findDueReminderCandidateTasks: vi.fn(),
  findOrgIdsWithDueRemindersDisabled: vi.fn(),
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
    storeMock.findOrgIdsWithDueRemindersDisabled.mockResolvedValue(new Set())
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

  it('対象タスクからoccurrence draftを作りmaterializeする（既定2オフセット）', async () => {
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([
      { id: 't-1', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-1', orgId: 'org-1' },
    ])
    storeMock.materializeDueReminderOccurrences.mockResolvedValue(2)

    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ candidates: 1, drafts: 2, materialized: 2 })
    const draftsArg = storeMock.materializeDueReminderOccurrences.mock.calls[0][0]
    expect(draftsArg).toHaveLength(2)
    expect(draftsArg.every((d: { taskId: string }) => d.taskId === 't-1')).toBe(true)
  })

  it('assignee無/done/due無のタスクはdraftが作られない（isDueReminderEligibleの回帰）', async () => {
    storeMock.findDueReminderCandidateTasks.mockResolvedValue([
      { id: 'no-assignee', dueDate: '2999-01-01', status: 'todo', assigneeId: null, orgId: 'org-1' },
      { id: 'done', dueDate: '2999-01-01', status: 'done', assigneeId: 'u-1', orgId: 'org-1' },
      { id: 'no-due', dueDate: null, status: 'todo', assigneeId: 'u-1', orgId: 'org-1' },
    ])

    const res = await callPost()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.drafts).toBe(0)
  })

  describe('org単位の自動期限リマインドオンオフ（org_channel_policy.due_reminders_enabled・§2・perf是正: tasks×spaces!inner埋め込みでorgIdを直接持つ）', () => {
    it('org無効(due_reminders_enabled=false)なら該当タスクのdraftを作らない', async () => {
      storeMock.findDueReminderCandidateTasks.mockResolvedValue([
        { id: 't-1', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-1', orgId: 'org-1' },
      ])
      storeMock.findOrgIdsWithDueRemindersDisabled.mockResolvedValue(new Set(['org-1']))

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.drafts).toBe(0)
      expect(storeMock.materializeDueReminderOccurrences).toHaveBeenCalledWith([])
    })

    it('org有効なタスクだけdraftを作る（無効orgと混在）', async () => {
      storeMock.findDueReminderCandidateTasks.mockResolvedValue([
        { id: 't-disabled', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-1', orgId: 'org-disabled' },
        { id: 't-enabled', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-2', orgId: 'org-enabled' },
      ])
      storeMock.findOrgIdsWithDueRemindersDisabled.mockResolvedValue(new Set(['org-disabled']))
      storeMock.materializeDueReminderOccurrences.mockResolvedValue(2)

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.drafts).toBe(2)
      const draftsArg = storeMock.materializeDueReminderOccurrences.mock.calls[0][0]
      expect(draftsArg.every((d: { taskId: string }) => d.taskId === 't-enabled')).toBe(true)
    })

    it('候補0件ならfindOrgIdsWithDueRemindersDisabledを呼ばない（無駄クエリを避ける）', async () => {
      storeMock.findDueReminderCandidateTasks.mockResolvedValue([])

      const res = await callPost()
      expect(res.status).toBe(200)
      expect(storeMock.findOrgIdsWithDueRemindersDisabled).not.toHaveBeenCalled()
    })
  })

  describe('HIGH-2是正: org設定を読めないときのフェイルクローズ退行防止', () => {
    it('findOrgIdsWithDueRemindersDisabledがthrowしても500にならず、候補全件でmaterializeを続行する', async () => {
      storeMock.findDueReminderCandidateTasks.mockResolvedValue([
        { id: 't-1', dueDate: '2999-01-01', status: 'todo', assigneeId: 'u-1', orgId: 'org-1' },
      ])
      storeMock.findOrgIdsWithDueRemindersDisabled.mockRejectedValue(
        new Error('column due_reminders_enabled does not exist'),
      )
      storeMock.materializeDueReminderOccurrences.mockResolvedValue(2)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await callPost()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.drafts).toBe(2)
      const draftsArg = storeMock.materializeDueReminderOccurrences.mock.calls[0][0]
      expect(draftsArg.every((d: { taskId: string }) => d.taskId === 't-1')).toBe(true)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
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

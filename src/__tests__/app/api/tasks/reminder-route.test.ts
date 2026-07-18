import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/tasks/[taskId]/reminder — 時刻指定リマインドの設定（③・pro以上限定）
 *
 * - 内部メンバーのみ（requireInternalMember。orgはタスクからサーバ側逆引き）
 * - remindAt を設定するとき org の timed_line_reminders が無ければ 403 plan_required
 *   （設定時ゲート＝二重防御のUX側。実行時cronが真の境界）
 * - remindAt=null（解除）はプラン不問
 */

const storeMock = {
  findTaskOrgId: vi.fn(),
  setTaskRemindAt: vi.fn(),
}
vi.mock('@/lib/reminders/taskReminderStore', () => storeMock)

const authMock = { requireInternalMember: vi.fn() }
vi.mock('@/lib/channels/authz', () => authMock)

const resolveEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveEntitlementsMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const { POST } = await import('@/app/api/tasks/[taskId]/reminder/route')

const TASK_ID = '11111111-1111-4111-8111-111111111111'

function call(taskId: string, body: unknown) {
  const request = new NextRequest(
    new URL(`/api/tasks/${taskId}/reminder`, 'http://localhost:3000'),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  return POST(request, { params: Promise.resolve({ taskId }) })
}

function entitled(has: boolean) {
  return { planId: has ? 'pro' : 'free', has: () => has }
}

describe('POST /api/tasks/[taskId]/reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.findTaskOrgId.mockResolvedValue({ orgId: 'org-1', spaceId: 'space-1' })
    storeMock.setTaskRemindAt.mockResolvedValue(undefined)
    authMock.requireInternalMember.mockResolvedValue({ ok: true, userId: 'u1', role: 'admin' })
    resolveEntitlementsMock.mockResolvedValue(entitled(true))
  })

  it('不正な taskId は 400', async () => {
    const res = await call('not-a-uuid', { remindAt: '2026-07-20T08:00:00.000Z' })
    expect(res.status).toBe(400)
  })

  it('存在しないタスクは 404', async () => {
    storeMock.findTaskOrgId.mockResolvedValue(null)
    const res = await call(TASK_ID, { remindAt: '2026-07-20T08:00:00.000Z' })
    expect(res.status).toBe(404)
  })

  it('非メンバーは 403', async () => {
    authMock.requireInternalMember.mockResolvedValue({ ok: false, status: 403, error: 'x' })
    const res = await call(TASK_ID, { remindAt: '2026-07-20T08:00:00.000Z' })
    expect(res.status).toBe(403)
    expect(storeMock.setTaskRemindAt).not.toHaveBeenCalled()
  })

  it('entitled: remindAt を設定して 200', async () => {
    const res = await call(TASK_ID, { remindAt: '2026-07-20T08:00:00.000Z' })
    expect(res.status).toBe(200)
    expect(storeMock.setTaskRemindAt).toHaveBeenCalledWith(TASK_ID, '2026-07-20T08:00:00.000Z')
  })

  it('未entitled で remindAt 設定は 403 plan_required(timed_line_reminders)', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled(false))
    const res = await call(TASK_ID, { remindAt: '2026-07-20T08:00:00.000Z' })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('plan_required')
    expect(json.feature).toBe('timed_line_reminders')
    expect(storeMock.setTaskRemindAt).not.toHaveBeenCalled()
  })

  it('未entitled でも remindAt=null(解除)はプラン不問で 200', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled(false))
    const res = await call(TASK_ID, { remindAt: null })
    expect(res.status).toBe(200)
    expect(storeMock.setTaskRemindAt).toHaveBeenCalledWith(TASK_ID, null)
  })

  it('不正な remindAt 文字列は 400', async () => {
    const res = await call(TASK_ID, { remindAt: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(storeMock.setTaskRemindAt).not.toHaveBeenCalled()
  })
})

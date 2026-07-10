import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/channels/digest-tasks — 申し送りタスクの消し込み/復旧（秘書コンソール用）
 *
 * {orgId, taskId, status: 'done'|'dismissed'|'open'}
 * 内部メンバーのみ。taskIdのorg一致をサーバ側で検証。done_via='console'
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const storeMock = {
  findDigestTaskOrgId: vi.fn(),
  updateDigestTaskStatusConsole: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { PATCH } = await import('@/app/api/channels/digest-tasks/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'

function callPatch(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/channels/digest-tasks', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request)
}

describe('PATCH /api/channels/digest-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.findDigestTaskOrgId.mockResolvedValue(ORG_ID)
    storeMock.updateDigestTaskStatusConsole.mockResolvedValue(true)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'done' })
    expect(response.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'done' })
    expect(response.status).toBe(403)
  })

  it('不正なstatusは400', async () => {
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'bogus' })
    expect(response.status).toBe(400)
  })

  it('他orgのtaskIdは404', async () => {
    storeMock.findDigestTaskOrgId.mockResolvedValue('org-OTHER')
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'done' })
    expect(response.status).toBe(404)
    expect(storeMock.updateDigestTaskStatusConsole).not.toHaveBeenCalled()
  })

  it('存在しないtaskIdは404', async () => {
    storeMock.findDigestTaskOrgId.mockResolvedValue(null)
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'done' })
    expect(response.status).toBe(404)
  })

  it('done: updateDigestTaskStatusConsoleを呼ぶ', async () => {
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'done' })
    expect(response.status).toBe(200)
    expect(storeMock.updateDigestTaskStatusConsole).toHaveBeenCalledWith(TASK_ID, 'done')
  })

  it('dismissed: updateDigestTaskStatusConsoleを呼ぶ', async () => {
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'dismissed' })
    expect(response.status).toBe(200)
    expect(storeMock.updateDigestTaskStatusConsole).toHaveBeenCalledWith(TASK_ID, 'dismissed')
  })

  it('open（復旧）: updateDigestTaskStatusConsoleを呼ぶ', async () => {
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'open' })
    expect(response.status).toBe(200)
    expect(storeMock.updateDigestTaskStatusConsole).toHaveBeenCalledWith(TASK_ID, 'open')
  })

  it('更新が0件（不整合）なら404', async () => {
    storeMock.updateDigestTaskStatusConsole.mockResolvedValue(false)
    const response = await callPatch({ orgId: ORG_ID, taskId: TASK_ID, status: 'done' })
    expect(response.status).toBe(404)
  })
})

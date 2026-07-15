import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/digest-tasks/approval — 承認/却下（コンソール経路・Stage 2.7-B §5）
 * 内部メンバーのみ入口。可否は RPC が再判定（承認者本人でなければ forbidden→403）。
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
  promoteDigestTask: vi.fn(),
  rejectDigestTask: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { POST } = await import('@/app/api/channels/digest-tasks/approval/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'

function callPost(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/digest-tasks/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/channels/digest-tasks/approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'approver-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.findDigestTaskOrgId.mockResolvedValue(ORG_ID)
    storeMock.promoteDigestTask.mockResolvedValue({ status: 'promoted', created: true, taskId: 'new-task-1' })
    storeMock.rejectDigestTask.mockResolvedValue({ status: 'rejected' })
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    expect(res.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    expect(res.status).toBe(403)
  })

  it('不正なactionは400', async () => {
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('他orgのtaskIdは404（RPCを呼ばない）', async () => {
    storeMock.findDigestTaskOrgId.mockResolvedValue('org-OTHER')
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    expect(res.status).toBe(404)
    expect(storeMock.promoteDigestTask).not.toHaveBeenCalled()
  })

  it('approve: promoted → 200 で session userId を actor に渡す', async () => {
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ status: 'promoted', created: true, taskId: 'new-task-1' })
    expect(storeMock.promoteDigestTask).toHaveBeenCalledWith(TASK_ID, 'approver-1')
  })

  it('approve: 承認者本人でない(forbidden) → 403', async () => {
    storeMock.promoteDigestTask.mockResolvedValue({ status: 'forbidden', created: false, taskId: null })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    expect(res.status).toBe(403)
  })

  it('approve: conflict → 409', async () => {
    storeMock.promoteDigestTask.mockResolvedValue({ status: 'conflict', created: false, taskId: null })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    expect(res.status).toBe(409)
  })

  it('approve: 冪等再実行(promoted, created=false) → 200', async () => {
    storeMock.promoteDigestTask.mockResolvedValue({ status: 'promoted', created: false, taskId: 'new-task-1' })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'approve' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.created).toBe(false)
  })

  it('reject: rejected → 200 で session userId を actor に渡す', async () => {
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'reject' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ status: 'rejected' })
    expect(storeMock.rejectDigestTask).toHaveBeenCalledWith(TASK_ID, 'approver-1')
    expect(storeMock.promoteDigestTask).not.toHaveBeenCalled()
  })

  it('reject: forbidden → 403', async () => {
    storeMock.rejectDigestTask.mockResolvedValue({ status: 'forbidden' })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'reject' })
    expect(res.status).toBe(403)
  })

  it('reject: not_found → 404', async () => {
    storeMock.rejectDigestTask.mockResolvedValue({ status: 'not_found' })
    const res = await callPost({ orgId: ORG_ID, taskId: TASK_ID, action: 'reject' })
    expect(res.status).toBe(404)
  })
})

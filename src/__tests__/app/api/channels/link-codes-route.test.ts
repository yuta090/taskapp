import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/link-codes — 顧問先突合コード発行
 * 内部メンバーのみ。コードは8桁英数（紛らわしい文字なし）で生成し30日有効
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

const createLinkCodeMock = vi.fn()
vi.mock('@/lib/channels/store', () => ({
  createLinkCode: (...args: unknown[]) => createLinkCodeMock(...args),
}))

const { POST } = await import('@/app/api/channels/link-codes/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/channels/link-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const validBody = {
  orgId: '11111111-1111-4111-8111-111111111111',
  spaceId: '22222222-2222-4222-8222-222222222222',
}

describe('POST /api/channels/link-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    createLinkCodeMock.mockImplementation((input: { code: string }) =>
      Promise.resolve({ id: 'code-1', code: input.code, expiresAt: '2026-08-09T00:00:00Z' }),
    )
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPost(validBody)
    expect(response.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const response = await callPost(validBody)
    expect(response.status).toBe(403)
  })

  it('spaceId欠落は400', async () => {
    const response = await callPost({ orgId: validBody.orgId })
    expect(response.status).toBe(400)
  })

  it('成功: 8桁コードを生成して返す', async () => {
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.code).toMatch(/^[A-Z2-9]{8}$/)
    expect(json.expiresAt).toBeTruthy()
    expect(createLinkCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: validBody.orgId,
        spaceId: validBody.spaceId,
        createdBy: 'staff-1',
      }),
    )
  })
})

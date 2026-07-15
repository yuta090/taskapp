import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/admin/blog — 記事のCRUD（superadmin限定 / service role書き込み）
 *
 * - 未認証(非superadmin) → 403
 * - 不正slug → 400
 * - slug重複(23505) → 409
 * - status=published で作成すると published_at がサーバー側で自動セットされる
 */

let isSuperadmin = true
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: vi.fn(() => Promise.resolve(isSuperadmin ? 'admin-user-id' : null)),
}))

let insertError: { code?: string; message: string } | null = null
let capturedInsert: Record<string, unknown> | null = null
const singleMock = vi.fn(() =>
  Promise.resolve({
    data: insertError ? null : { id: 'new-id', ...capturedInsert },
    error: insertError,
  })
)
const selectMock = vi.fn(() => ({ single: singleMock }))
const insertMock = vi.fn((row: Record<string, unknown>) => {
  capturedInsert = row
  return { select: selectMock }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: insertMock })),
  })),
}))

const { POST } = await import('@/app/api/admin/blog/route')

function callPost(body: Record<string, unknown>) {
  return POST(
    new NextRequest(new URL('/api/admin/blog', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/admin/blog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSuperadmin = true
    insertError = null
    capturedInsert = null
  })

  it('非superadmin は 403', async () => {
    isSuperadmin = false
    const res = await callPost({ slug: 'ok', title: 'タイトル' })
    expect(res.status).toBe(403)
  })

  it('不正な slug は 400', async () => {
    const res = await callPost({ slug: 'Bad Slug', title: 'タイトル' })
    expect(res.status).toBe(400)
  })

  it('slug 重複(23505) は 409', async () => {
    insertError = { code: '23505', message: 'duplicate key' }
    const res = await callPost({ slug: 'dup', title: 'タイトル' })
    expect(res.status).toBe(409)
  })

  it('draft 作成では published_at は null のまま', async () => {
    const res = await callPost({ slug: 'draft-post', title: '下書き', status: 'draft' })
    expect(res.status).toBe(200)
    expect(capturedInsert?.published_at).toBeNull()
  })

  it('published 作成では published_at がサーバー側で自動セットされる', async () => {
    const res = await callPost({ slug: 'live-post', title: '公開記事', status: 'published' })
    expect(res.status).toBe(200)
    expect(capturedInsert?.published_at).toBeTruthy()
    expect(typeof capturedInsert?.published_at).toBe('string')
  })
})

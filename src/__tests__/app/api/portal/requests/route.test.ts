import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock data
const mockUser = { id: 'client-user-123' }
const mockMembership = {
  space_id: 'space-001',
  spaces: { id: 'space-001', org_id: 'org-001' },
}
const mockCreatedTask = { id: 'task-new-001' }

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: typeof mockMembership | null; error: null }
let insertResponse: { data: typeof mockCreatedTask | null; error: null | { message: string } }

// Mock audit log
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
  generateAuditSummary: vi.fn(() => 'summary'),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => {
    return Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(membershipResponse)),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'tasks') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(insertResponse)),
              })),
            })),
          }
        }
        return {}
      }),
    })
  }),
}))

const { POST } = await import('@/app/api/portal/requests/route')

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('/api/portal/requests', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'TestBrowser/1.0' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/portal/requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: mockMembership, error: null }
    insertResponse = { data: mockCreatedTask, error: null }
  })

  // --- Authentication ---

  it('should return 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    expect(response.status).toBe(401)
  })

  it('should return 403 when user has no client membership', async () => {
    membershipResponse = { data: null, error: null }
    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    expect(response.status).toBe(403)
  })

  // --- Validation: common fields ---

  it('should return 400 when title is empty', async () => {
    const response = await POST(createRequest({ title: '', category: 'feature', description: 'test' }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('タイトル')
  })

  it('should return 400 when title is missing', async () => {
    const response = await POST(createRequest({ category: 'feature', description: 'test' }))
    expect(response.status).toBe(400)
  })

  it('should return 400 when category is invalid', async () => {
    const response = await POST(createRequest({ title: 'Test', category: 'invalid', description: 'test' }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('カテゴリ')
  })

  // --- Feature request ---

  it('should create a feature request successfully', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.taskId).toBe('task-new-001')
  })

  it('should return 400 when feature request has no description', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('機能の内容')
  })

  // --- Question ---

  it('should create a question successfully', async () => {
    const response = await POST(createRequest({
      title: '担当者の追加方法',
      category: 'question',
      description: 'クライアント側で担当者を追加できますか？',
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('should return 400 when question has no description', async () => {
    const response = await POST(createRequest({
      title: '担当者の追加方法',
      category: 'question',
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('質問内容')
  })

  // --- Bug report ---

  it('should create a bug report with all required fields', async () => {
    const response = await POST(createRequest({
      title: 'ログイン画面でボタンが反応しない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン画面',
        steps: '1. メールアドレスを入力\n2. パスワードを入力\n3. ログインボタンを押す',
        actual: 'ボタンを押しても何も起きない',
        expected: 'ダッシュボードに遷移する',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.taskId).toBe('task-new-001')
  })

  it('should return 400 when bug report has no bugDetails', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('バグの詳細')
  })

  it('should return 400 when bug report screen is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: '',
        steps: '手順',
        actual: '実際',
        expected: '期待',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('発生した画面')
  })

  it('should return 400 when bug report steps is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '',
        actual: '実際',
        expected: '期待',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('再現手順')
  })

  it('should return 400 when bug report actual is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '手順',
        actual: '',
        expected: '期待',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('実際に起きたこと')
  })

  it('should return 400 when bug report expected is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '手順',
        actual: '実際',
        expected: '',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('期待する動作')
  })

  it('should return 400 when bug report frequency is invalid', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '手順',
        actual: '実際',
        expected: '期待',
        frequency: 'invalid',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('発生頻度')
  })

  it('should include optional note in bug report', async () => {
    const response = await POST(createRequest({
      title: '表示崩れ',
      category: 'bug',
      description: 'Safariでのみ発生する模様',
      bugDetails: {
        screen: 'ダッシュボード',
        steps: '1. ダッシュボードを開く',
        actual: 'レイアウトが崩れる',
        expected: '正常に表示される',
        frequency: 'sometimes',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  // --- Error handling ---

  it('should return 500 when task insert fails', async () => {
    insertResponse = { data: null, error: { message: 'DB error' } }
    const response = await POST(createRequest({
      title: 'CSV出力',
      category: 'feature',
      description: '内容',
    }))
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data.error).toContain('リクエストの送信に失敗')
  })
})

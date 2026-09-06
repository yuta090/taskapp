import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock Supabase - シンプルなmock構造
const mockUser = { id: 'user-123' }
const mockMembership = { id: 'membership-1', role: 'admin' }
const mockTasks = [
  {
    id: 'task-1',
    title: 'Test Task',
    description: 'Description',
    type: 'task',
    status: 'todo',
    priority: 1,
    due_date: '2024-02-15',
    ball: 'internal',
    origin: 'internal',
    spec_path: null,
    decision_state: null,
    created_at: '2024-02-01T10:00:00Z',
    updated_at: '2024-02-01T10:00:00Z',
    assignee_id: null,
    milestone_id: null,
  },
]

interface MockPricingRow {
  task_id: string
  cost_hours: string | null
  cost_unit_price: string | null
  cost_total: string | null
  margin_rate: string | null
  sell_total: string | null
  vendor_submitted_at: string | null
  agency_approved_at: string | null
  client_approved_at: string | null
}

const mockPricing: MockPricingRow[] = [
  {
    task_id: 'task-1',
    cost_hours: '10.00',
    cost_unit_price: '5000.00',
    cost_total: '50000.00',
    margin_rate: '20.00',
    sell_total: '60000.00',
    vendor_submitted_at: '2024-02-02T10:00:00Z',
    agency_approved_at: null,
    client_approved_at: null,
  },
]

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: typeof mockMembership | null; error: null }
let tasksResponse: { data: typeof mockTasks | null; error: null }
let pricingResponse: { data: typeof mockPricing | null; error: null }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => {
    const chainable = {
      from: vi.fn(() => chainable),
      select: vi.fn(() => chainable),
      eq: vi.fn(() => chainable),
      in: vi.fn(() => chainable),
      order: vi.fn(() => tasksResponse),
      single: vi.fn(() => membershipResponse),
    }
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
                  neq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(membershipResponse)),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => Promise.resolve(tasksResponse)),
              })),
            })),
          }
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          }
        }
        if (table === 'milestones') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          }
        }
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: { name: 'TestProject' }, error: null })),
              })),
            })),
          }
        }
        if (table === 'task_pricing') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => Promise.resolve(pricingResponse)),
            })),
          }
        }
        if (table === 'export_templates') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({ data: null, error: null })),
                })),
              })),
            })),
          }
        }
        return chainable
      }),
    })
  }),
}))

// Dynamic import after mock setup
const { GET } = await import('@/app/api/export/tasks/route')

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'))
}

describe('GET /api/export/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default responses
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: mockMembership, error: null }
    tasksResponse = { data: mockTasks, error: null }
    pricingResponse = { data: mockPricing, error: null }
  })

  it('should return 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }

    const request = createRequest('/api/export/tasks?spaceId=11111111-1111-4111-8111-111111111111')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('should return 400 when spaceId is missing', async () => {
    const request = createRequest('/api/export/tasks')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid or missing spaceId')
  })

  it('should return 400 when spaceId is invalid UUID', async () => {
    const request = createRequest('/api/export/tasks?spaceId=invalid-uuid')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid or missing spaceId')
  })

  it('should return 403 when user is not a member of the space', async () => {
    membershipResponse = { data: null, error: null }

    const request = createRequest('/api/export/tasks?spaceId=11111111-1111-4111-8111-111111111111')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied')
  })

  it('should return 400 when templateId is invalid UUID', async () => {
    const request = createRequest('/api/export/tasks?spaceId=11111111-1111-4111-8111-111111111111&templateId=invalid')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid templateId format')
  })
})

/**
 * 金額列（見積・請求）— 会計ソフトへ取り込むために必要な列。
 *
 * 設計の要点:
 *  - 既定の書き出しには**含めない**（既存利用者のCSVの形を変えない）。明示指定でのみ出る。
 *  - 原価と売値が同じ表に並ぶため、**役割で出し分ける**。vendor に売値（＝マージン）が
 *    渡ると取引事故になるので、金額列は admin/editor のみ。それ以外は列ごと落とす。
 */
const SPACE = '11111111-1111-4111-8111-111111111111'

describe('GET /api/export/tasks — 金額列', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: mockMembership, error: null }
    tasksResponse = { data: mockTasks, error: null }
    pricingResponse = { data: mockPricing, error: null }
  })

  it('admin は金額列を書き出せる', async () => {
    const request = createRequest(
      `/api/export/tasks?spaceId=${SPACE}&columns=id,title,cost_hours,cost_unit_price,cost_total,margin_rate,sell_total,pricing_status`,
    )
    const response = await GET(request)
    const csv = await response.text()
    const [headerRow, dataRow] = csv.replace(/^﻿/, '').split('\n')

    expect(response.status).toBe(200)
    expect(headerRow).toBe('ID,タイトル,工数(時間),原価単価,原価合計,利益率(%),請求金額,見積状態')
    expect(dataRow).toBe('task-1,Test Task,10,5000,50000,20,60000,見積提出済')
  })

  it('editor も金額列を書き出せる', async () => {
    membershipResponse = { data: { id: 'membership-1', role: 'editor' }, error: null }

    const request = createRequest(`/api/export/tasks?spaceId=${SPACE}&columns=id,title,sell_total`)
    const response = await GET(request)
    const csv = await response.text()

    expect(csv).toContain('請求金額')
    expect(csv).toContain('60000')
  })

  it('vendor には金額列を出さない（売値＝マージンの漏洩を防ぐ）', async () => {
    membershipResponse = { data: { id: 'membership-1', role: 'vendor' }, error: null }

    const request = createRequest(
      `/api/export/tasks?spaceId=${SPACE}&columns=id,title,cost_total,sell_total`,
    )
    const response = await GET(request)
    const csv = await response.text()
    const [headerRow, dataRow] = csv.replace(/^﻿/, '').split('\n')

    expect(response.status).toBe(200)
    expect(headerRow).toBe('ID,タイトル')
    expect(dataRow).toBe('task-1,Test Task')
    expect(csv).not.toContain('60000')
    expect(csv).not.toContain('50000')
  })

  it('viewer にも金額列を出さない', async () => {
    membershipResponse = { data: { id: 'membership-1', role: 'viewer' }, error: null }

    const request = createRequest(`/api/export/tasks?spaceId=${SPACE}&columns=id,sell_total`)
    const response = await GET(request)
    const csv = await response.text()

    expect(csv.replace(/^﻿/, '').split('\n')[0]).toBe('ID')
  })

  it('列を指定しない既定の書き出しには金額列を含めない（既存の形を変えない）', async () => {
    const request = createRequest(`/api/export/tasks?spaceId=${SPACE}`)
    const response = await GET(request)
    const csv = await response.text()

    expect(csv).not.toContain('請求金額')
    expect(csv).not.toContain('原価合計')
  })

  it('見積が未入力のタスクは金額欄を空にする', async () => {
    pricingResponse = { data: [], error: null }

    const request = createRequest(`/api/export/tasks?spaceId=${SPACE}&columns=id,cost_total,sell_total,pricing_status`)
    const response = await GET(request)
    const csv = await response.text()
    const dataRow = csv.replace(/^﻿/, '').split('\n')[1]

    expect(dataRow).toBe('task-1,,,未入力')
  })

  it('承認まで進んでいれば見積状態に反映する', async () => {
    pricingResponse = {
      data: [{ ...mockPricing[0], agency_approved_at: '2024-02-03T10:00:00Z', client_approved_at: '2024-02-04T10:00:00Z' }],
      error: null,
    }

    const request = createRequest(`/api/export/tasks?spaceId=${SPACE}&columns=id,pricing_status`)
    const response = await GET(request)
    const csv = await response.text()

    expect(csv.replace(/^﻿/, '').split('\n')[1]).toBe('task-1,顧客承認済')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock Supabase - シンプルなmock構造
const mockUser = { id: 'user-123' }
const mockMembership = { id: 'membership-1' }
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

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: typeof mockMembership | null; error: null }
let tasksResponse: { data: typeof mockTasks | null; error: null }

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
                  single: vi.fn(() => Promise.resolve(membershipResponse)),
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

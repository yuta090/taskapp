import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveReturnAssignee } from '@/app/api/portal/tasks/resolveReturnAssignee'

function buildSupabaseMock(membershipData: { role: string } | null) {
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: membershipData, error: null })),
        })),
      })),
    })),
  }))
  return { from } as unknown as SupabaseClient
}

describe('resolveReturnAssignee (H-1)', () => {
  it('falls back to created_by when assignee_id is null', async () => {
    const supabase = buildSupabaseMock(null)

    const result = await resolveReturnAssignee(supabase, {
      spaceId: 'space-1',
      assigneeId: null,
      createdBy: 'internal-user-1',
    })

    expect(result).toBe('internal-user-1')
  })

  it('falls back to created_by when the current assignee is a client member', async () => {
    const supabase = buildSupabaseMock({ role: 'client' })

    const result = await resolveReturnAssignee(supabase, {
      spaceId: 'space-1',
      assigneeId: 'client-reviewer-1',
      createdBy: 'internal-user-1',
    })

    expect(result).toBe('internal-user-1')
  })

  it('falls back to created_by when the assignee is no longer a space member at all', async () => {
    const supabase = buildSupabaseMock(null)

    const result = await resolveReturnAssignee(supabase, {
      spaceId: 'space-1',
      assigneeId: 'removed-user',
      createdBy: 'internal-user-1',
    })

    expect(result).toBe('internal-user-1')
  })

  it('keeps the current assignee when they are already an internal member', async () => {
    const supabase = buildSupabaseMock({ role: 'editor' })

    const result = await resolveReturnAssignee(supabase, {
      spaceId: 'space-1',
      assigneeId: 'internal-dev-1',
      createdBy: 'internal-user-1',
    })

    expect(result).toBe('internal-dev-1')
  })

  it('returns null when there is no assignee and no creator to fall back to', async () => {
    const supabase = buildSupabaseMock(null)

    const result = await resolveReturnAssignee(supabase, {
      spaceId: 'space-1',
      assigneeId: null,
      createdBy: null,
    })

    expect(result).toBeNull()
  })
})

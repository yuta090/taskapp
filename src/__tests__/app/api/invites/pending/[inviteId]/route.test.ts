import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_INVITE_ID = '33333333-3333-4333-8333-333333333333'
const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'

const mockUser = { id: 'user-1', email: 'owner@example.com' }

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let inviteLookupResponse: { data: { id: string; org_id: string } | null; error: { message: string } | null }
let deleteResponse: { error: { message: string } | null }

const deleteEqMock = vi.fn(() => Promise.resolve(deleteResponse))
const invitesQueryChain = {
  select: vi.fn(function (this: unknown) { return this }),
  eq: vi.fn(function (this: unknown) { return this }),
  single: vi.fn(() => Promise.resolve(inviteLookupResponse)),
  delete: vi.fn(() => ({ eq: deleteEqMock })),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(orgMembershipResponse)),
                })),
              })),
            })),
          }
        }
        return {}
      }),
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'invites') return invitesQueryChain
      return {}
    }),
  })),
}))

const { DELETE } = await import('@/app/api/invites/pending/[inviteId]/route')

function callDelete(inviteId: string) {
  const request = new NextRequest(new URL(`/api/invites/pending/${inviteId}`, 'http://localhost:3000'), {
    method: 'DELETE',
  })
  return DELETE(request, { params: Promise.resolve({ inviteId }) })
}

describe('DELETE /api/invites/pending/[inviteId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    orgMembershipResponse = { data: { role: 'owner' } }
    inviteLookupResponse = { data: { id: VALID_INVITE_ID, org_id: VALID_ORG_ID }, error: null }
    deleteResponse = { error: null }
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callDelete(VALID_INVITE_ID)

    expect(response.status).toBe(401)
  })

  it('returns 404 when the invite does not exist', async () => {
    inviteLookupResponse = { data: null, error: { message: 'not found' } }

    const response = await callDelete(VALID_INVITE_ID)

    expect(response.status).toBe(404)
  })

  it('returns 403 when the caller is not the owner of the invite\'s org', async () => {
    orgMembershipResponse = { data: { role: 'member' } }

    const response = await callDelete(VALID_INVITE_ID)

    expect(response.status).toBe(403)
  })

  it('deletes the invite and returns success for the org owner', async () => {
    const response = await callDelete(VALID_INVITE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(invitesQueryChain.delete).toHaveBeenCalled()
    expect(deleteEqMock).toHaveBeenCalledWith('id', VALID_INVITE_ID)
  })

  it('returns 500 when the delete fails', async () => {
    deleteResponse = { error: { message: 'db error' } }

    const response = await callDelete(VALID_INVITE_ID)

    expect(response.status).toBe(500)
  })
})

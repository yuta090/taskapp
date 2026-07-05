import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `/portal/preview/[spaceId]` — internal-facing read-only preview of the
 * client portal dashboard. Authorization has three branches:
 *   - internal org member (role != 'client') -> renders the dashboard
 *   - client role -> redirect('/portal') (they have the real portal)
 *   - not an org member at all -> notFound() (no space-id probing)
 */

const mockUser = { id: 'internal-user-1' }

let authResponse: { data: { user: typeof mockUser | null } }
let spaceResponse: { data: { id: string; name: string; org_id: string } | null; error: null | { message: string } }
let membershipResponse: { data: { role: string } | null; error: null }

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super('NEXT_REDIRECT')
  }
}
class NotFoundSignal extends Error {
  constructor() {
    super('NEXT_NOT_FOUND')
  }
}

const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination)
})
const notFoundMock = vi.fn(() => {
  throw new NotFoundSignal()
})

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => redirectMock(destination),
  notFound: () => notFoundMock(),
}))

const fetchPortalDashboardDataMock = vi.fn(() =>
  Promise.resolve({
    health: { status: 'on_track', reason: '', nextMilestone: undefined },
    alert: { overdueCount: 0, nextDueDate: null },
    actionTasks: [],
    totalActionCount: 0,
    waitingMessage: 'すべてのタスクが確認済みです',
    progress: { completedCount: 0, totalCount: 0, deadline: null },
    milestones: [],
    ballOwnership: { clientCount: 0, teamCount: 0 },
    currentPhaseProgress: { completedCount: 0, totalCount: 0, phaseName: '' },
    activities: [],
    approvals: [],
  })
)

vi.mock('@/lib/portal/fetchPortalDashboardData', () => ({
  fetchPortalDashboardData: (...args: unknown[]) => fetchPortalDashboardDataMock(...args),
}))

vi.mock('@/app/portal/PortalDashboardClient', () => ({
  PortalDashboardClient: (props: { previewMode?: boolean; currentProject: { id: string; name: string; orgId: string } }) => (
    <div data-testid="portal-dashboard-client" data-preview-mode={String(!!props.previewMode)}>
      {props.currentProject.name}
    </div>
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(spaceResponse)),
              })),
            })),
          }
        }
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() => Promise.resolve(membershipResponse)),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { default: PortalPreviewPage } = await import('@/app/portal/preview/[spaceId]/page')

function renderPage() {
  return PortalPreviewPage({ params: Promise.resolve({ spaceId: 'space-1' }) })
}

describe('PortalPreviewPage authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    spaceResponse = { data: { id: 'space-1', name: 'サンプルプロジェクト', org_id: 'org-1' }, error: null }
    membershipResponse = { data: { role: 'member' }, error: null }
  })

  it('redirects unauthenticated visitors to /login', async () => {
    authResponse = { data: { user: null } }

    await expect(renderPage()).rejects.toBeInstanceOf(RedirectSignal)
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })

  it('renders the read-only dashboard preview for an internal org member', async () => {
    const result = await renderPage()
    expect(result).toBeTruthy()
    expect(fetchPortalDashboardDataMock).toHaveBeenCalledWith(expect.anything(), 'space-1')
    expect(redirectMock).not.toHaveBeenCalled()
    expect(notFoundMock).not.toHaveBeenCalled()
  })

  it('redirects a client-role member to the real portal (they already have one)', async () => {
    membershipResponse = { data: { role: 'client' }, error: null }

    await expect(renderPage()).rejects.toBeInstanceOf(RedirectSignal)
    expect(redirectMock).toHaveBeenCalledWith('/portal')
  })

  it('returns notFound for a user with no membership in the space org (no space-id probing)', async () => {
    membershipResponse = { data: null, error: null }

    await expect(renderPage()).rejects.toBeInstanceOf(NotFoundSignal)
  })

  it('returns notFound when the space does not exist', async () => {
    spaceResponse = { data: null, error: { message: 'not found' } }

    await expect(renderPage()).rejects.toBeInstanceOf(NotFoundSignal)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockUser = { id: 'user-1', email: 'owner@example.com' }

let authResponse: { data: { user: typeof mockUser | null }; error: { message: string } | null }
let profileSelectResponse: { data: { onboarding_flags: Record<string, boolean> } | null; error: { message: string } | null }
let upsertResponse: { error: { message: string } | null }

const mockSelect = vi.fn()
const mockSelectEq = vi.fn()
const mockSingle = vi.fn()
const mockUpsert = vi.fn()
const mockFrom = vi.fn()

const sendWelcomeEmailMock = vi.fn()

vi.mock('@/lib/email/welcome', () => ({
  sendWelcomeEmail: (...args: unknown[]) => sendWelcomeEmailMock(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: mockFrom,
    })
  ),
}))

const { POST } = await import('@/app/api/onboarding/welcome-email/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/onboarding/welcome-email', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('POST /api/onboarding/welcome-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authResponse = { data: { user: mockUser }, error: null }
    profileSelectResponse = { data: { onboarding_flags: {} }, error: null }
    upsertResponse = { error: null }
    sendWelcomeEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' })

    mockFrom.mockImplementation(() => ({ select: mockSelect, upsert: mockUpsert }))
    mockSelect.mockReturnValue({ eq: mockSelectEq })
    mockSelectEq.mockReturnValue({ single: mockSingle })
    mockSingle.mockImplementation(() => Promise.resolve(profileSelectResponse))
    // upsert (not update) — the profiles row may not exist yet if the
    // on_auth_user_created trigger hasn't run.
    mockUpsert.mockImplementation(() => Promise.resolve(upsertResponse))
  })

  it('returns 401 when there is no authenticated user', async () => {
    authResponse = { data: { user: null }, error: null }

    const res = await callPost({ orgName: 'テスト組織' })

    expect(res.status).toBe(401)
    expect(sendWelcomeEmailMock).not.toHaveBeenCalled()
  })

  it('sends the welcome email on first call and marks the flag as sent', async () => {
    const res = await callPost({ orgName: 'テスト組織' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(sendWelcomeEmailMock).toHaveBeenCalledWith({
      to: 'owner@example.com',
      orgName: 'テスト組織',
      dryRun: false,
    })
    expect(mockUpsert).toHaveBeenCalledWith(
      { id: 'user-1', onboarding_flags: { welcome_email_sent: true } },
      { onConflict: 'id' }
    )
  })

  it('returns skipped without sending when the flag is already set', async () => {
    profileSelectResponse = { data: { onboarding_flags: { welcome_email_sent: true } }, error: null }

    const res = await callPost({ orgName: 'テスト組織' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ skipped: true })
    expect(sendWelcomeEmailMock).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('does not send or update the flag when dryRun is true', async () => {
    sendWelcomeEmailMock.mockResolvedValue({ success: true, skipped: true, reason: 'dry_run' })

    const res = await callPost({ orgName: 'テスト組織', dryRun: true })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(sendWelcomeEmailMock).toHaveBeenCalledWith({
      to: 'owner@example.com',
      orgName: 'テスト組織',
      dryRun: true,
    })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 200 without updating the flag when RESEND is not configured', async () => {
    sendWelcomeEmailMock.mockResolvedValue({ success: true, skipped: true, reason: 'resend_not_configured' })

    const res = await callPost({ orgName: 'テスト組織' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.skipped).toBe(true)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('ignores an orgName field with the wrong type', async () => {
    const res = await callPost({ orgName: 123 as unknown as string })

    expect(res.status).toBe(200)
    expect(sendWelcomeEmailMock).toHaveBeenCalledWith({
      to: 'owner@example.com',
      orgName: '',
      dryRun: false,
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'
const VALID_SPACE_ID = '22222222-2222-4222-8222-222222222222'

const mockUser = {
  id: 'user-1',
  email: 'owner@example.com',
  user_metadata: {} as Record<string, unknown>,
}

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let spaceMembershipResponse: { data: { role: string } | null }
let organizationResponse: { data: { name: string } | null }
let spaceResponse: { data: { name: string } | null }
let profileResponse: { data: { display_name: string } | null }
let rpcResponse: {
  data: Record<string, unknown> | null
  error: { message: string; code?: string; details?: string } | null
}
let setTemplateResponse: { data: null; error: { message: string } | null }

const sendInviteEmailMock = vi.fn((..._args: unknown[]) => Promise.resolve({ success: true, messageId: 'msg-1' }))

vi.mock('@/lib/email', () => ({
  sendInviteEmail: (...args: unknown[]) => sendInviteEmailMock(...args),
}))

const inviteUpdateMock = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ update: inviteUpdateMock }) }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) }, 
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
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(spaceMembershipResponse)),
                })),
              })),
            })),
          }
        }
        if (table === 'organizations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(organizationResponse)),
              })),
            })),
          }
        }
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(spaceResponse)),
              })),
            })),
          }
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(profileResponse)),
              })),
            })),
          }
        }
        return {}
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'rpc_set_org_email_template') return Promise.resolve(setTemplateResponse)
        return Promise.resolve(rpcResponse)
      }),
    })
  ),
}))

const { POST } = await import('@/app/api/invites/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/invites', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const baseBody = {
  org_id: VALID_ORG_ID,
  space_id: VALID_SPACE_ID,
  email: 'invitee@example.com',
  role: 'member',
}

describe('POST /api/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authResponse = { data: { user: { ...mockUser, user_metadata: {} } } }
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    organizationResponse = { data: { name: 'テスト組織' } }
    spaceResponse = { data: { name: 'テストプロジェクト' } }
    profileResponse = { data: { display_name: 'プロフィール太郎' } }
    rpcResponse = {
      data: { invite_id: 'invite-1', token: 'tok-123', expires_at: '2026-08-01T00:00:00' },
      error: null,
    }
    setTemplateResponse = { data: null, error: null }
    sendInviteEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' })
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callPost(baseBody)

    expect(response.status).toBe(401)
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ org_id: VALID_ORG_ID, space_id: VALID_SPACE_ID, role: 'member' })

    expect(response.status).toBe(400)
  })

  it('returns 400 when the message exceeds 500 characters', async () => {
    const response = await callPost({ ...baseBody, message: 'a'.repeat(501) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/500/)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('accepts a message of exactly 500 characters', async () => {
    const response = await callPost({ ...baseBody, message: 'a'.repeat(500) })

    expect(response.status).toBe(200)
  })

  it('returns 403 when the caller lacks org/space permission', async () => {
    orgMembershipResponse = { data: null }
    spaceMembershipResponse = { data: null }

    const response = await callPost(baseBody)

    expect(response.status).toBe(403)
  })

  // 人数枠に当たったときは「英語の例外そのまま・400」ではなく、日本語の案内＋402（要アップグレード）で返す。
  // 402 は課金起因の拒否として相手先グループ枠と揃える（クライアントは code で分岐できる）。
  it('人数枠に達したら402＋日本語の案内＋code=member_limit_reached を返す', async () => {
    rpcResponse = { data: null, error: { message: 'Organization has reached member limit. Please upgrade your plan.' } }

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(402)
    expect(data.code).toBe('member_limit_reached')
    expect(data.error).toContain('メンバー')
    expect(data.error).not.toMatch(/Organization has reached/)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('相手先(client)枠のメッセージも日本語＋402に畳む', async () => {
    rpcResponse = { data: null, error: { message: 'Organization has reached client limit. Please upgrade your plan.' } }

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(402)
    expect(data.code).toBe('client_limit_reached')
    expect(data.error).not.toMatch(/Organization has reached/)
  })

  // 理由を利用者に説明できない例外は、DB の生の文言を画面に出さない（サーバーログにだけ残す）
  it('人数枠以外のRPCエラーは、生の文言を返さず日本語の一律案内＋400にする', async () => {
    rpcResponse = { data: null, error: { message: 'something else went wrong' } }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('招待の作成に失敗しました。時間をおいてもう一度お試しください。')
    expect(data.error).not.toMatch(/something else/)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  // 組織の役割と招待の種類が合わないときは、DB が決まった符号で断る（20260912151932_invite_role_consistency.sql）。
  // 画面には「次にできること」が分かる日本語＋409 を返す
  it('IRC01（すでに社内メンバーとして参加）は409＋日本語で返す', async () => {
    rpcResponse = {
      data: null,
      error: { message: 'invite_org_role_conflict', code: 'IRC01', details: 'org_role=member invite_role=client' },
    }

    const response = await callPost({ ...baseBody, role: 'client' })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('社内メンバーとして参加している')
    expect(data.error).not.toMatch(/invite_org_role_conflict/)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('IRC02（種類の違う承諾待ちがある）は409＋取り消しの案内を返す', async () => {
    rpcResponse = { data: null, error: { message: 'invite_pending_kind_conflict', code: 'IRC02' } }

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('先にその招待を取り消してください')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('IRC03（協力会社は代理店モードだけ）は409＋日本語で返す', async () => {
    rpcResponse = { data: null, error: { message: 'invite_vendor_requires_agency_mode', code: 'IRC03' } }

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('代理店モード')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('returns 409 with a Japanese message when the invitee is already a member (RPC dedup guard)', async () => {
    rpcResponse = { data: null, error: { message: 'already a member' } }

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('既にメンバーです')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('sends the invite email with the message and reports email_sent: true', async () => {
    const response = await callPost({ ...baseBody, message: 'よろしくお願いします' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.email_sent).toBe(true)
    expect(data.token).toBe('tok-123')
    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'よろしくお願いします' })
    )
  })

  it('prioritizes the profiles display_name for the inviter name', async () => {
    await callPost(baseBody)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'プロフィール太郎' })
    )
  })

  it('falls back to user_metadata.full_name when there is no profile display name', async () => {
    profileResponse = { data: null }
    authResponse = {
      data: { user: { ...mockUser, user_metadata: { full_name: 'メタデータ次郎' } } },
    }

    await callPost(baseBody)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'メタデータ次郎' })
    )
  })

  it('falls back to email, then 管理者, when neither profile nor metadata name exists', async () => {
    profileResponse = { data: null }
    authResponse = {
      data: { user: { ...mockUser, user_metadata: {}, email: 'owner@example.com' } },
    }

    await callPost(baseBody)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'owner@example.com' })
    )
  })

  it('reports email_sent: false when the email send fails, but still returns the invite', async () => {
    sendInviteEmailMock.mockRejectedValueOnce(new Error('Resend down'))

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.email_sent).toBe(false)
    expect(data.token).toBe('tok-123')
  })
})

/**
 * 招待フォームでの「その場編集」。
 * 既定はその1通かぎり。「テンプレートとして保存する」を選んだときだけ事務所の文面として残る。
 */
describe('POST /api/invites — 文面のその場編集と保存', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    authResponse = { data: { user: { ...mockUser, user_metadata: {} } } }
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    organizationResponse = { data: { name: 'テスト組織' } }
    spaceResponse = { data: { name: 'テストプロジェクト' } }
    profileResponse = { data: { display_name: 'プロフィール太郎' } }
    rpcResponse = {
      data: { invite_id: 'invite-1', token: 'tok-123', expires_at: '2026-08-01T00:00:00' },
      error: null,
    }
    setTemplateResponse = { data: null, error: null }
    sendInviteEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' })
  })

  it('その場で直した文面で送る', async () => {
    const response = await callPost({ ...baseBody, template: { subject: '差し替えた件名', body: '差し替えた本文' } })

    expect(response.status).toBe(200)
    const sent = sendInviteEmailMock.mock.calls[0][0] as { fields?: { subject: string; body: string } }
    expect(sent.fields?.subject).toBe('差し替えた件名')
    expect(sent.fields?.body).toBe('差し替えた本文')
  })

  it('文面を触っていなければ、送信側に文面を渡さない（いつもの決まり方に任せる）', async () => {
    const response = await callPost(baseBody)

    expect(response.status).toBe(200)
    const sent = sendInviteEmailMock.mock.calls[0][0] as { fields?: unknown; orgId?: string }
    expect(sent.fields).toBeUndefined()
    expect(sent.orgId).toBe(VALID_ORG_ID)
  })

  it('使えない差し込み語があれば400で断り、招待も作らない', async () => {
    const response = await callPost({ ...baseBody, template: { body: '{{存在しない語}}' } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('存在しない語')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('件名を空にはできない', async () => {
    const response = await callPost({ ...baseBody, template: { subject: '   ' } })

    expect(response.status).toBe(400)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('保存にチェックしていなければ、テンプレートは書き換えない', async () => {
    await callPost({ ...baseBody, template: { subject: '今回だけ' } })

    const response = await callPost({ ...baseBody, template: { subject: '今回だけ' } })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.template_saved).toBeUndefined()
  })

  it('保存にチェックすると、事務所の文面として保存する', async () => {
    const response = await callPost({
      ...baseBody,
      template: { subject: '保存する件名' },
      save_as_template: true,
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.template_saved).toBe(true)
  })

  it('事務所の管理者でなければ保存させない（招待も作らない）', async () => {
    orgMembershipResponse = { data: { role: 'member' } }

    const response = await callPost({
      ...baseBody,
      template: { subject: '保存する件名' },
      save_as_template: true,
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toContain('管理者')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('保存に失敗しても招待とメールは止めない（保存できなかったことは返す）', async () => {
    setTemplateResponse = { data: null, error: { message: 'boom' } }

    const response = await callPost({
      ...baseBody,
      template: { subject: '保存する件名' },
      save_as_template: true,
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.template_saved).toBe(false)
    expect(sendInviteEmailMock).toHaveBeenCalled()
  })
})

describe('POST /api/invites — 相手の名前', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    authResponse = { data: { user: { ...mockUser, user_metadata: {} } } }
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    organizationResponse = { data: { name: 'テスト組織' } }
    spaceResponse = { data: { name: 'テストプロジェクト' } }
    profileResponse = { data: { display_name: 'プロフィール太郎' } }
    rpcResponse = {
      data: { invite_id: 'invite-1', token: 'tok-123', expires_at: '2026-08-01T00:00:00' },
      error: null,
    }
    setTemplateResponse = { data: null, error: null }
    sendInviteEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' })
  })

  it('名前を招待に保存し、メールの宛名にも使う', async () => {
    const response = await callPost({ ...baseBody, name: '  山田 太郎  ' })

    expect(response.status).toBe(200)
    expect(inviteUpdateMock).toHaveBeenCalledWith({ invitee_name: '山田 太郎' })
    const sent = sendInviteEmailMock.mock.calls[0][0] as { toName?: string }
    expect(sent.toName).toBe('山田 太郎')
  })

  it('名前が空なら書き込まない', async () => {
    await callPost({ ...baseBody, name: '   ' })

    expect(inviteUpdateMock).not.toHaveBeenCalled()
    const sent = sendInviteEmailMock.mock.calls[0][0] as { toName?: string }
    expect(sent.toName).toBeUndefined()
  })

  it('長すぎる名前は切り詰める（招待自体は通す）', async () => {
    await callPost({ ...baseBody, name: 'あ'.repeat(150) })

    expect(inviteUpdateMock).toHaveBeenCalledWith({ invitee_name: 'あ'.repeat(100) })
  })
})

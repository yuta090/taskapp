import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_SPACE_ID = '22222222-2222-4222-8222-222222222222'
const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'

const mockUser = { id: 'user-1', email: 'owner@example.com' }

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let spaceMembershipResponse: { data: { role: string } | null }
let spaceResponse: { data: { org_id: string } | null }

const resolveEmailTemplateMock = vi.fn()
const rpcMock = vi.fn()
let rpcResponse: { error: { message: string } | null }

vi.mock('@/lib/email/templates/orgEmailTemplate', () => ({
  resolveEmailTemplate: (...args: unknown[]) => resolveEmailTemplateMock(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve(authResponse)) },
      rpc: (...args: unknown[]) => {
        rpcMock(...args)
        return Promise.resolve(rpcResponse)
      },
      from: vi.fn((table: string) => {
        if (table === 'spaces') {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve(spaceResponse) }) }) }
        }
        if (table === 'org_memberships') {
          return { select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(orgMembershipResponse) }) }) }) }
        }
        if (table === 'space_memberships') {
          return { select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(spaceMembershipResponse) }) }) }) }
        }
        return {}
      }),
    })
  ),
}))

const { GET, DELETE } = await import('@/app/api/invites/template/route')

function callGet(query: string) {
  return GET(new NextRequest(new URL(`/api/invites/template?${query}`, 'http://localhost:3000')))
}

function callDelete(query: string) {
  return DELETE(
    new NextRequest(new URL(`/api/invites/template?${query}`, 'http://localhost:3000'), { method: 'DELETE' })
  )
}

const fields = { subject: '件名', heading: '見出し', body: '本文', cta_label: 'ボタン', note: '' }

describe('GET /api/invites/template', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    spaceResponse = { data: { org_id: VALID_ORG_ID } }
    resolveEmailTemplateMock.mockResolvedValue({ fields, source: 'code' })
    rpcResponse = { error: null }
  })

  it('いま使われている文面と、どこの文面かを返す', async () => {
    const response = await callGet(`space_id=${VALID_SPACE_ID}&role=member`)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.fields).toEqual(fields)
    expect(data.source).toBe('code')
    expect(resolveEmailTemplateMock).toHaveBeenCalledWith(VALID_ORG_ID, 'invite_member')
  })

  it('役割ごとに違う文面を引く', async () => {
    await callGet(`space_id=${VALID_SPACE_ID}&role=client`)
    expect(resolveEmailTemplateMock).toHaveBeenCalledWith(VALID_ORG_ID, 'invite_client')
  })

  it('事務所の管理者なら保存できると返す', async () => {
    const data = await (await callGet(`space_id=${VALID_SPACE_ID}&role=member`)).json()
    expect(data.can_save_template).toBe(true)
  })

  it('事務所の管理者でなければ保存できないと返す（閲覧はできる）', async () => {
    orgMembershipResponse = { data: { role: 'member' } }
    const response = await callGet(`space_id=${VALID_SPACE_ID}&role=member`)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.can_save_template).toBe(false)
  })

  it('未ログインは401', async () => {
    authResponse = { data: { user: null } }
    expect((await callGet(`space_id=${VALID_SPACE_ID}&role=member`)).status).toBe(401)
  })

  it('プロジェクトに権限が無ければ403', async () => {
    spaceMembershipResponse = { data: { role: 'viewer' } }
    expect((await callGet(`space_id=${VALID_SPACE_ID}&role=member`)).status).toBe(403)
  })

  it('事務所に属していなければ403', async () => {
    orgMembershipResponse = { data: null }
    expect((await callGet(`space_id=${VALID_SPACE_ID}&role=member`)).status).toBe(403)
  })

  it('役割が不正なら400', async () => {
    expect((await callGet(`space_id=${VALID_SPACE_ID}&role=nope`)).status).toBe(400)
  })

  it('プロジェクトIDの形式が不正なら400', async () => {
    expect((await callGet('space_id=not-a-uuid&role=member')).status).toBe(400)
  })

  it('存在しないプロジェクトなら404', async () => {
    spaceResponse = { data: null }
    expect((await callGet(`space_id=${VALID_SPACE_ID}&role=member`)).status).toBe(404)
  })
})

describe('DELETE /api/invites/template — 標準の文面に戻す', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    spaceResponse = { data: { org_id: VALID_ORG_ID } }
    rpcResponse = { error: null }
  })

  it('事務所の保存を消す', async () => {
    const response = await callDelete(`space_id=${VALID_SPACE_ID}&role=member`)

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('rpc_reset_org_email_template', {
      p_org_id: VALID_ORG_ID,
      p_key: 'invite_member',
    })
  })

  it('事務所の管理者でなければ403（消させない）', async () => {
    orgMembershipResponse = { data: { role: 'member' } }

    const response = await callDelete(`space_id=${VALID_SPACE_ID}&role=member`)

    expect(response.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('DBが断ったら500で返す', async () => {
    rpcResponse = { error: { message: 'boom' } }

    expect((await callDelete(`space_id=${VALID_SPACE_ID}&role=member`)).status).toBe(500)
  })
})

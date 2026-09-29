import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/slack/notify の本人確認。ブラウザ（Cookie）に加え、スマホアプリ（Bearer）からも呼べる。
 * 無効なトークンでは Slack に送らない。送るときの actorId は確かめた本人（body の actorId は使わない）。
 */

const notifyAllMock = vi.fn(async (..._args: unknown[]) => [])
vi.mock('@/lib/notifications', () => ({
  notificationRegistry: { get: () => ({}), register: vi.fn(), notifyAll: (...a: unknown[]) => notifyAllMock(...a) },
}))
vi.mock('@/lib/slack/provider', () => ({ SlackNotificationProvider: vi.fn() }))

let cookieUser: Record<string, unknown> | null = null
/** 呼んだ人の所属（RLS が効くセッションのクライアントで確かめる） */
let orgMember: { role: string } | null = { role: 'member' }
let spaceMember: { role: string } | null = null
const memberQueries: string[] = []
function sessionFrom(table: string) {
  memberQueries.push(table)
  const data = table === 'org_memberships' ? orgMember : table === 'space_memberships' ? spaceMember : null
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.neq = () => b
  b.maybeSingle = async () => ({ data, error: null })
  return b
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: cookieUser }, error: cookieUser ? null : { message: 'no session' } })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
    from: sessionFrom,
  })),
}))

let bearerUser: Record<string, unknown> | null = null
vi.mock('@/lib/supabase/bearer', () => ({
  createBearerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async (jwt: string) =>
        jwt.startsWith('good') && bearerUser
          ? { data: { user: bearerUser }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } }
      ),
    },
    from: sessionFrom,
  })),
}))

function single(data: unknown) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.single = async () => ({ data })
  return b
}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'tasks')
        return single({ id: 't1', title: 'T', status: 'todo', ball: 'internal', origin: 'internal', type: 'task', due_date: null, assignee_id: null, description: null })
      if (table === 'spaces') return single({ name: 'S', org_id: 'o1' })
      return single({ display_name: '山田' })
    },
  })),
}))

const { POST } = await import('@/app/api/slack/notify/route')

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = `good.${b64({ aal: 'aal1' })}.sig`
const body = { event: 'comment_added', taskId: 't1', spaceId: 's1', actorId: 'someone-else' }

function call(headers: Record<string, string>) {
  return POST(
    new NextRequest(new URL('/api/slack/notify', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/slack/notify — 本人確認', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieUser = null
    bearerUser = { id: 'u-mobile' }
    orgMember = { role: 'member' }
    spaceMember = null
    memberQueries.length = 0
  })

  it('そのタスクの組織にもプロジェクトにも入っていない人は 403 で、Slack に送らない（他組織の Slack に投稿させない）', async () => {
    orgMember = null
    spaceMember = null
    expect((await call({ Authorization: `Bearer ${token}` })).status).toBe(403)
    expect(notifyAllMock).not.toHaveBeenCalled()
  })

  it('相手先（client）の所属だけでは送れない', async () => {
    orgMember = { role: 'client' }
    expect((await call({ Authorization: `Bearer ${token}` })).status).toBe(403)
    expect(notifyAllMock).not.toHaveBeenCalled()
  })

  it('プロジェクトのメンバーなら送れる（組織の所属が無くても）', async () => {
    orgMember = null
    spaceMember = { role: 'editor' }
    expect((await call({ Authorization: `Bearer ${token}` })).status).toBe(200)
  })

  it('所属はログインした本人のクライアント（RLS が効く側）で確かめる', async () => {
    await call({ Authorization: `Bearer ${token}` })
    expect(memberQueries).toContain('org_memberships')
  })

  it('ログインしていなければ 401', async () => {
    expect((await call({})).status).toBe(401)
    expect(notifyAllMock).not.toHaveBeenCalled()
  })

  it('無効な Bearer トークンなら 401 で、Slack に送らない', async () => {
    expect((await call({ Authorization: 'Bearer bad' })).status).toBe(401)
    expect(notifyAllMock).not.toHaveBeenCalled()
  })

  it('有効な Bearer トークンなら送り、actorId は確かめた本人にする', async () => {
    const res = await call({ Authorization: `Bearer ${token}` })
    expect(res.status).toBe(200)
    expect(notifyAllMock).toHaveBeenCalledTimes(1)
    expect((notifyAllMock.mock.calls[0][1] as { actorId: string }).actorId).toBe('u-mobile')
  })

  it('2段階認証の途中のトークンなら 403', async () => {
    bearerUser = { id: 'u-mobile', factors: [{ status: 'verified' }] }
    expect((await call({ Authorization: `Bearer ${token}` })).status).toBe(403)
    expect(notifyAllMock).not.toHaveBeenCalled()
  })

  it('Cookie のログインでも今までどおり送る', async () => {
    cookieUser = { id: 'u-web' }
    expect((await call({})).status).toBe(200)
    expect((notifyAllMock.mock.calls[0][1] as { actorId: string }).actorId).toBe('u-web')
  })
})

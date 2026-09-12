import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 運営ダッシュボードの「最近のアクティビティ」欄。audit_logs→profilesの外部キーは
 * 本番に無いため、埋め込み(actor_profile:profiles!audit_logs_actor_id_fkey)は
 * PGRST200で必ず失敗する。別問い合わせで表示名を引き、無ければメールで補う。
 */

let auditLogsResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let profilesResponse: { data: Array<{ id: string; display_name: string | null }> | null; error?: { message: string } | null }
let getUserByIdImpl: (id: string) => Promise<{ data: { user: { email: string } | null } }>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'order', 'limit', 'in']) {
    builder[m] = vi.fn(() => builder)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

const fromMock = vi.fn((table: string) => {
  if (table === 'audit_logs') return chain(auditLogsResponse)
  if (table === 'profiles') return chain(profilesResponse)
  throw new Error(`Unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: vi.fn((id: string) => getUserByIdImpl(id)),
      },
    },
    from: fromMock,
  })),
}))

const { fetchRecentActivity } = await import('@/lib/admin/recentActivity')

describe('fetchRecentActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auditLogsResponse = { data: [], error: null }
    profilesResponse = { data: [] }
    getUserByIdImpl = () => Promise.resolve({ data: { user: null } })
  })

  it('埋め込みを使わず、別問い合わせで引いたprofilesから表示名を組み立てる', async () => {
    auditLogsResponse = {
      data: [
        { id: 'log-1', event_type: 'task_created', summary: null, occurred_at: '2026-01-01T00:00:00Z', actor_id: 'user-1' },
      ],
      error: null,
    }
    profilesResponse = { data: [{ id: 'user-1', display_name: '太郎' }] }

    const rows = await fetchRecentActivity()

    expect(rows).toHaveLength(1)
    expect(rows[0].actorName).toBe('太郎')
  })

  it('表示名が無い行はメールで補い、それも無ければSystemにする', async () => {
    auditLogsResponse = {
      data: [
        { id: 'log-1', event_type: 'x', summary: null, occurred_at: '2026-01-01T00:00:00Z', actor_id: 'user-1' },
        { id: 'log-2', event_type: 'y', summary: null, occurred_at: '2026-01-01T00:00:00Z', actor_id: null },
      ],
      error: null,
    }
    // 誰の表示名も引けない(profiles側で見つからない)想定
    profilesResponse = { data: [] }
    getUserByIdImpl = (id) =>
      Promise.resolve({ data: { user: id === 'user-1' ? { email: 'taro@example.com' } : null } })

    const rows = await fetchRecentActivity()

    expect(rows[0].actorName).toBe('taro@example.com')
    expect(rows[1].actorName).toBe('System')
  })

  it('audit_logsのクエリでエラーが起きたら空配列を返す', async () => {
    auditLogsResponse = { data: null, error: { message: 'boom' } }

    const rows = await fetchRecentActivity()

    expect(rows).toEqual([])
  })

  it('profilesのクエリでエラーが起きたら、他の問い合わせと同じくコンソールに記録する(空文字表示で握り潰さない)', async () => {
    auditLogsResponse = {
      data: [
        { id: 'log-1', event_type: 'x', summary: null, occurred_at: '2026-01-01T00:00:00Z', actor_id: 'user-1' },
      ],
      error: null,
    }
    profilesResponse = { data: null, error: { message: 'boom' } }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await fetchRecentActivity()

    expect(errorSpy).toHaveBeenCalledWith('[admin/dashboard] profiles query error:', 'boom')
    errorSpy.mockRestore()
  })

  it('actor_idが無い行しかない場合はprofilesを問い合わせない', async () => {
    auditLogsResponse = {
      data: [{ id: 'log-1', event_type: 'x', summary: null, occurred_at: '2026-01-01T00:00:00Z', actor_id: null }],
      error: null,
    }
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()

    await fetchRecentActivity()

    // profiles テーブルへの問い合わせ自体が発生していないこと
    expect(admin.from).not.toHaveBeenCalledWith('profiles')
  })
})

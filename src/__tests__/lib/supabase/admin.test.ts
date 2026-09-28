import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * createAdminClient() の attribution 引数。
 *
 * change_log トリガー（誰が・どの経路で書いたか。supabase 側 PR #1027）は
 * service_role の JWT のときだけ x-agentpm-* ヘッダーを信用する。attribution を渡した
 * ときだけこのヘッダーが付き、渡さなければ（既存の呼び出し全部が今も無引数）
 * 従来どおりヘッダー無しのまま — 呼び出し側を壊さない。
 *
 * ⚠ セキュリティ: ここで使うのは呼び出し元が明示的に渡した値だけ。受け取ったリクエストの
 * ヘッダー（x-agentpm-*）をそのまま転送する経路があってはいけない（なりすまし防止）。
 */

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service-key'

const createClientCalls: { url: string; key: string; options: Record<string, unknown> }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    createClientCalls.push({ url, key, options })
    return { __fake: true }
  },
}))

function headersOf(callIndex: number): Record<string, string> {
  const options = createClientCalls[callIndex].options
  return ((options.global as Record<string, unknown> | undefined)?.headers as Record<string, string>) || {}
}

beforeEach(() => {
  createClientCalls.length = 0
})

describe('createAdminClient — attribution 無し（既存の呼び出しと同じ）', () => {
  it('ヘッダーを付けない', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient()

    expect(headersOf(0)).toEqual({})
  })
})

describe('createAdminClient — attribution あり', () => {
  it('channel を x-agentpm-channel に載せる', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'portal' })

    expect(headersOf(0)['x-agentpm-channel']).toBe('portal')
  })

  it('actorUserId を x-agentpm-actor-id に載せる', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'admin', actorUserId: '11111111-1111-4111-8111-111111111111' })

    expect(headersOf(0)['x-agentpm-actor-id']).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('actorUserId が UUID の形でなければ落とす（DB 側の uuid 列に渡すため）', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'admin', actorUserId: 'not-a-uuid' })

    expect(headersOf(0)).not.toHaveProperty('x-agentpm-actor-id')
  })

  it('actorUserId が無ければ x-agentpm-actor-id を付けない', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'cron' })

    expect(headersOf(0)).not.toHaveProperty('x-agentpm-actor-id')
  })

  it('apiKeyId を x-agentpm-api-key-id に載せる', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'cli', apiKeyId: '22222222-2222-4222-8222-222222222222' })

    expect(headersOf(0)['x-agentpm-api-key-id']).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('apiKeyId が UUID の形でなければ落とす', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'cli', apiKeyId: 'dev-key' })

    expect(headersOf(0)).not.toHaveProperty('x-agentpm-api-key-id')
  })

  it('requestId を渡せばそのまま使う。渡さなければ自動で作る', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient({ channel: 'webhook', requestId: 'req-123' })
    createAdminClient({ channel: 'webhook' })

    expect(headersOf(0)['x-agentpm-request-id']).toBe('req-123')
    expect(headersOf(1)['x-agentpm-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(headersOf(1)['x-agentpm-request-id']).not.toBe(headersOf(0)['x-agentpm-request-id'])
  })
})

describe('createAdminClient — なりすまし防止', () => {
  it('引数以外（受け取ったリクエストのヘッダー等）はどんな形で渡しても無視する', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    // attribution オブジェクトに紛れ込んだ余計なプロパティは無視される
    createAdminClient({
      channel: 'app',
      // @ts-expect-error 型に無いキーを紛れ込ませても効かないことを確かめる
      'x-agentpm-actor-id': 'someone-elses-id',
    })

    expect(headersOf(0)['x-agentpm-actor-id']).toBeUndefined()
  })
})

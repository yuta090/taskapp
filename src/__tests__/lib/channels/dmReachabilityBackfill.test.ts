import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * DM到達不能の日次照合ジョブ（dmReachabilityReconcile）が使うstore関数2つ:
 *
 * - listActiveOrgDmLinks: owner_type='org'（自社LINE。DMは自社LINEのみ§7）配下の
 *   active(revoked_at is null)な1:1紐付けを、access_token(復号済み)付きで一覧する。
 * - isDmUnreachableForUser: line-status API（オンボーディング/秘書コンソールのLINE連携状態
 *   表示）向け。対象ユーザーのactiveな紐付けが dm_unreachable_at 非NULL(到達不能マーク済み)か。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'is', 'not', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFulfilled: (value: any) => unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRejected?: (reason: any) => unknown,
  ) => Promise.resolve(response).then(onFulfilled, onRejected)
  return builder
}

let fromResponses: Record<string, unknown>
let rpcResponses: Record<string, unknown>
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const store = await import('@/lib/channels/store')

function accountJoin(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    org_id: 'org-1',
    display_name: 'test bot',
    credentials_encrypted: 'enc-blob',
    status: 'active',
    owner_type: 'org',
    ...over,
  }
}

function linkRow(over: Record<string, unknown> = {}) {
  return {
    org_id: 'org-1',
    channel_account_id: 'acc-1',
    external_user_id: 'U-1',
    dm_unreachable_at: null,
    channel_accounts: accountJoin(),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  fromResponses = {}
  rpcResponses = {
    decrypt_system_secret: {
      data: JSON.stringify({ channel_secret: 'secret', access_token: 'token-abc' }),
      error: null,
    },
  }
  fromMock.mockImplementation((table: string) => chain(fromResponses[table] ?? { data: null, error: null }))
  rpcMock.mockImplementation((fn: string) => Promise.resolve(rpcResponses[fn] ?? { data: null, error: null }))
})

describe('listActiveOrgDmLinks', () => {
  it('active な org(自社LINE) DM紐付けを、復号済みaccessToken付きで返す', async () => {
    fromResponses['channel_user_links'] = { data: [linkRow()], error: null }

    const result = await store.listActiveOrgDmLinks()

    expect(result).toEqual([
      {
        orgId: 'org-1',
        accountId: 'acc-1',
        accessToken: 'token-abc',
        externalUserId: 'U-1',
        dmUnreachableAt: null,
      },
    ])
  })

  it('revoked_at is null・owner_type=org・account status=active で絞り込む', async () => {
    fromResponses['channel_user_links'] = { data: [], error: null }
    await store.listActiveOrgDmLinks()

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
    expect(call.eq).toHaveBeenCalledWith('channel_accounts.owner_type', 'org')
    expect(call.eq).toHaveBeenCalledWith('channel_accounts.status', 'active')
  })

  it('dmUnreachableAt がマーク済みの行はその値をそのまま返す', async () => {
    fromResponses['channel_user_links'] = {
      data: [linkRow({ dm_unreachable_at: '2026-07-20T00:00:00.000Z' })],
      error: null,
    }
    const result = await store.listActiveOrgDmLinks()
    expect(result[0].dmUnreachableAt).toBe('2026-07-20T00:00:00.000Z')
  })

  it('同一accountを指す複数行があっても復号(rpc呼び出し)は1回にまとめる', async () => {
    fromResponses['channel_user_links'] = {
      data: [linkRow({ external_user_id: 'U-1' }), linkRow({ external_user_id: 'U-2' })],
      error: null,
    }
    const result = await store.listActiveOrgDmLinks()
    expect(result).toHaveLength(2)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('復号に失敗した行はベストエフォートでスキップする（他の行には影響しない）', async () => {
    rpcResponses.decrypt_system_secret = { data: null, error: { message: 'decrypt failed' } }
    fromResponses['channel_user_links'] = { data: [linkRow()], error: null }
    const result = await store.listActiveOrgDmLinks()
    expect(result).toEqual([])
  })

  it('0件ならクエリ結果が空配列', async () => {
    fromResponses['channel_user_links'] = { data: [], error: null }
    const result = await store.listActiveOrgDmLinks()
    expect(result).toEqual([])
  })

  it('DBエラーはthrowする', async () => {
    fromResponses['channel_user_links'] = { data: null, error: { message: 'boom' } }
    await expect(store.listActiveOrgDmLinks()).rejects.toThrow(/list active org dm links failed/)
  })
})

describe('isDmUnreachableForUser', () => {
  it('activeな紐付けが dm_unreachable_at 非NULL(到達不能マーク済み)なら true', async () => {
    fromResponses['channel_user_links'] = { data: [{ id: 'link-1' }], error: null }
    const result = await store.isDmUnreachableForUser('org-1', 'user-1')
    expect(result).toBe(true)
  })

  it('マーク無しなら false', async () => {
    fromResponses['channel_user_links'] = { data: [], error: null }
    const result = await store.isDmUnreachableForUser('org-1', 'user-1')
    expect(result).toBe(false)
  })

  it('org_id/user_id/revoked_at is null/dm_unreachable_at not null で絞り込む', async () => {
    fromResponses['channel_user_links'] = { data: [], error: null }
    await store.isDmUnreachableForUser('org-1', 'user-1')

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(call.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
    expect(call.not).toHaveBeenCalledWith('dm_unreachable_at', 'is', null)
  })

  it('DBエラーはthrowする', async () => {
    fromResponses['channel_user_links'] = { data: null, error: { message: 'boom' } }
    await expect(store.isDmUnreachableForUser('org-1', 'user-1')).rejects.toThrow(
      /dm unreachable check failed/,
    )
  })
})

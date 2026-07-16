import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * channel_accounts の owner_type('org'|'platform')対応（Stage 4 §1/§2）。
 *
 * - decryptAccount は owner_type に応じて OrgLineAccount(orgId: string) /
 *   PlatformLineAccount(orgId: null) を作り分ける。
 * - findLineAccountForOrg は owner_type='org' を明示条件に加える（platformを除外）。
 * - findLineAccountByIdLookup はグループ送信(§3)向けにaccount_idで直接解決する
 *   （findLineAccountForOrgのorg→account逆引きに依存しない）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
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

const ORG_ACCOUNT_ROW = {
  id: 'acc-org-1',
  org_id: 'org-1',
  display_name: '山田会計事務所',
  credentials_encrypted: 'enc-blob',
  status: 'active',
  owner_type: 'org',
}

const PLATFORM_ACCOUNT_ROW = {
  id: 'acc-platform-1',
  org_id: null,
  display_name: 'agentpm秘書',
  credentials_encrypted: 'enc-blob',
  status: 'active',
  owner_type: 'platform',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  fromResponses = {}
  rpcResponses = {
    decrypt_system_secret: {
      data: JSON.stringify({ channel_secret: 'secret', access_token: 'token' }),
      error: null,
    },
  }
  fromMock.mockImplementation((table: string) => chain(fromResponses[table] ?? { data: null, error: null }))
  rpcMock.mockImplementation((fn: string) => Promise.resolve(rpcResponses[fn] ?? { data: null, error: null }))
})

describe('findLineAccountByDestination / findLineAccountById: owner_type分岐', () => {
  it('owner_type=orgの行は OrgLineAccount(orgId: string) を返す', async () => {
    fromResponses['channel_accounts'] = { data: ORG_ACCOUNT_ROW, error: null }
    const account = await store.findLineAccountByDestination('Ubot-1')

    expect(account).toEqual({
      ownerType: 'org',
      id: 'acc-org-1',
      orgId: 'org-1',
      displayName: '山田会計事務所',
      channelSecret: 'secret',
      accessToken: 'token',
      status: 'active',
    })
  })

  it('owner_type=platformの行は PlatformLineAccount(orgId: null) を返す', async () => {
    fromResponses['channel_accounts'] = { data: PLATFORM_ACCOUNT_ROW, error: null }
    const account = await store.findLineAccountById('acc-platform-1')

    expect(account).toEqual({
      ownerType: 'platform',
      id: 'acc-platform-1',
      orgId: null,
      displayName: 'agentpm秘書',
      channelSecret: 'secret',
      accessToken: 'token',
      status: 'active',
    })
  })

  it('SELECT列にowner_typeを含む', async () => {
    fromResponses['channel_accounts'] = { data: ORG_ACCOUNT_ROW, error: null }
    await store.findLineAccountByDestination('Ubot-1')
    const call = fromMock.mock.results[0].value
    expect(call.select).toHaveBeenCalledWith(expect.stringContaining('owner_type'))
  })
})

describe('findLineAccountForOrg: owner_type=orgを明示条件に加える', () => {
  it('org_idに加えowner_type=orgでフィルタする（platform除外・設計正本§2）', async () => {
    fromResponses['channel_accounts'] = { data: ORG_ACCOUNT_ROW, error: null }
    await store.findLineAccountForOrg('org-1')

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(call.eq).toHaveBeenCalledWith('owner_type', 'org')
  })

  it('disabledはstatusのみ返し復号しない', async () => {
    fromResponses['channel_accounts'] = { data: { ...ORG_ACCOUNT_ROW, status: 'disabled' }, error: null }
    const result = await store.findLineAccountForOrg('org-1')
    expect(result).toEqual({ id: 'acc-org-1', status: 'disabled', account: null })
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('findLineAccountByIdLookup: グループ送信用のaccount_id直接解決（設計正本§3）', () => {
  it('account_idで解決し、owner_typeによらずactiveなら復号済みaccountを返す', async () => {
    fromResponses['channel_accounts'] = { data: PLATFORM_ACCOUNT_ROW, error: null }
    const result = await store.findLineAccountByIdLookup('acc-platform-1')

    expect(result).toEqual({
      id: 'acc-platform-1',
      status: 'active',
      account: {
        ownerType: 'platform',
        id: 'acc-platform-1',
        orgId: null,
        displayName: 'agentpm秘書',
        channelSecret: 'secret',
        accessToken: 'token',
        status: 'active',
      },
    })
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('id', 'acc-platform-1')
  })

  it('存在しないaccountIdはnull', async () => {
    fromResponses['channel_accounts'] = { data: null, error: null }
    const result = await store.findLineAccountByIdLookup('missing')
    expect(result).toBeNull()
  })

  it('disabledはstatusのみ返し復号しない', async () => {
    fromResponses['channel_accounts'] = { data: { ...ORG_ACCOUNT_ROW, status: 'disabled' }, error: null }
    const result = await store.findLineAccountByIdLookup('acc-org-1')
    expect(result).toEqual({ id: 'acc-org-1', status: 'disabled', account: null })
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

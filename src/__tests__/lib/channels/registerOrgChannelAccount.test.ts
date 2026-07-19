import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * registerOrgChannelAccount — 非LINEチャットチャネルの資格情報登録（作成/ローテート）。
 *
 * - 資格情報は encrypt_system_secret で暗号化して credentials_encrypted に保存する。
 * - owner_type='org' / org_id は呼び出し側が渡した org に固定（platform は作らせない）。
 * - 既存の active な org account（同一 org×channel）があれば資格情報を更新（ローテート）、
 *   無ければ新規 INSERT する。owner_type/org_id は immutable ガードがあるため触らない。
 * - operatorCredentials と generatedCredentials（webhook_secret 等）をマージして1つのJSONにする。
 */

// 呼び出し順に応答を取り出せるキュー式モック（find→insert/update で別応答を返すため）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let fromQueue: Record<string, unknown[]>
let rpcResponses: Record<string, unknown>
const fromMock = vi.fn()
const rpcMock = vi.fn()
const insertPayloads: Record<string, unknown>[] = []
const updatePayloads: Record<string, unknown>[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const store = await import('@/lib/channels/store')

const ORG = 'org-1'

function newAccountRow(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-new-1',
    org_id: ORG,
    channel: 'telegram',
    display_name: 'テレグラム秘書',
    line_bot_user_id: null,
    status: 'active',
    created_at: '2026-07-20T00:00:00.000Z',
    owner_type: 'org',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  fromQueue = {}
  insertPayloads.length = 0
  updatePayloads.length = 0
  rpcResponses = {
    encrypt_system_secret: { data: 'ENCRYPTED_BLOB', error: null },
  }
  fromMock.mockImplementation((table: string) => {
    const queue = fromQueue[table] ?? []
    const response = queue.length > 0 ? queue.shift() : { data: null, error: null }
    const builder = chain(response)
    // 実際に渡された payload を捕捉する
    const origInsert = builder.insert
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      insertPayloads.push(payload)
      return origInsert(payload)
    })
    const origUpdate = builder.update
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload)
      return origUpdate(payload)
    })
    return builder
  })
  rpcMock.mockImplementation((fn: string) => Promise.resolve(rpcResponses[fn] ?? { data: null, error: null }))
})

describe('registerOrgChannelAccount: 新規作成', () => {
  beforeEach(() => {
    fromQueue['channel_accounts'] = [
      { data: null, error: null }, // find reusable → 無し
      { data: newAccountRow(), error: null }, // insert 結果
    ]
  })

  it('資格情報を暗号化して INSERT し、created=true・生成値・メタを返す', async () => {
    const result = await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: 'テレグラム秘書',
      operatorCredentials: { bot_token: '123:abc' },
      generatedCredentials: { webhook_secret: 'whsec_xxx' },
    })

    expect(result.created).toBe(true)
    expect(result.generatedSecrets).toEqual({ webhook_secret: 'whsec_xxx' })
    expect(result.account).toEqual({
      id: 'acc-new-1',
      orgId: ORG,
      channel: 'telegram',
      displayName: 'テレグラム秘書',
      lineBotUserId: null,
      status: 'active',
      createdAt: '2026-07-20T00:00:00.000Z',
      ownerType: 'org',
    })
  })

  it('encrypt_system_secret に operator+generated をマージしたJSONを渡す', async () => {
    await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: 'テレグラム秘書',
      operatorCredentials: { bot_token: '123:abc' },
      generatedCredentials: { webhook_secret: 'whsec_xxx' },
    })
    const call = rpcMock.mock.calls.find((c) => c[0] === 'encrypt_system_secret')
    expect(call).toBeTruthy()
    const plaintext = (call![1] as { plaintext: string }).plaintext
    expect(JSON.parse(plaintext)).toEqual({ bot_token: '123:abc', webhook_secret: 'whsec_xxx' })
  })

  it('INSERT は owner_type=org / org_id=呼び出し org / 暗号文を含む（platformを作らせない）', async () => {
    await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: 'テレグラム秘書',
      operatorCredentials: { bot_token: '123:abc' },
    })
    expect(insertPayloads[0]).toMatchObject({
      org_id: ORG,
      owner_type: 'org',
      channel: 'telegram',
      display_name: 'テレグラム秘書',
      credentials_encrypted: 'ENCRYPTED_BLOB',
      status: 'active',
    })
  })

  it('暗号化に失敗したら投げる（平文をDBに残さない）', async () => {
    rpcResponses['encrypt_system_secret'] = { data: null, error: { message: 'boom' } }
    await expect(
      store.registerOrgChannelAccount({
        orgId: ORG,
        channel: 'telegram',
        displayName: 'x',
        operatorCredentials: { bot_token: 't' },
      }),
    ).rejects.toThrow(/encrypt_system_secret/)
    expect(insertPayloads.length).toBe(0)
  })
})

describe('registerOrgChannelAccount: 既存 org account があればローテート（再利用）', () => {
  const existingCredRow = {
    id: 'acc-existing-1',
    org_id: ORG,
    display_name: '旧表示名',
    credentials_encrypted: 'OLD_ENC',
    status: 'active',
    owner_type: 'org',
    channel: 'telegram',
  }

  beforeEach(() => {
    // find reusable → 有り / findChannelAccountCredentials の行 / update 結果
    fromQueue['channel_accounts'] = [
      { data: { id: 'acc-existing-1' }, error: null },
      { data: existingCredRow, error: null },
      { data: newAccountRow({ id: 'acc-existing-1' }), error: null },
    ]
    // 既存 credentials（webhook_secret は既に発行済み）
    rpcResponses['decrypt_system_secret'] = {
      data: JSON.stringify({ bot_token: 'old', webhook_secret: 'whsec_OLD' }),
      error: null,
    }
  })

  it('INSERTせず UPDATE で資格情報を差し替え、created=false を返す', async () => {
    const result = await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: '新表示名',
      operatorCredentials: { bot_token: 'new:token' },
      generatedCredentials: { webhook_secret: 'whsec_new' },
    })
    expect(result.created).toBe(false)
    expect(result.account.id).toBe('acc-existing-1')
    expect(insertPayloads.length).toBe(0)
    expect(updatePayloads[0]).toMatchObject({
      credentials_encrypted: 'ENCRYPTED_BLOB',
      display_name: '新表示名',
      status: 'active',
    })
  })

  it('既存の webhook_secret を維持して回転させない（受信を無言で壊さない）', async () => {
    const result = await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: '新表示名',
      operatorCredentials: { bot_token: 'new:token' },
      generatedCredentials: { webhook_secret: 'whsec_new' }, // これは使われず既存を維持
    })
    // 返却する生成値は既存のまま
    expect(result.generatedSecrets).toEqual({ webhook_secret: 'whsec_OLD' })
    // 暗号化に渡すJSONも既存 webhook_secret を維持し、bot_token だけ更新
    const encCall = rpcMock.mock.calls.find((c) => c[0] === 'encrypt_system_secret')
    const plaintext = (encCall![1] as { plaintext: string }).plaintext
    expect(JSON.parse(plaintext)).toEqual({ bot_token: 'new:token', webhook_secret: 'whsec_OLD' })
  })

  it('UPDATE で owner_type / org_id は触らない（immutable ガード違反を避ける）', async () => {
    await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: 'x',
      operatorCredentials: { bot_token: 't' },
    })
    expect(updatePayloads[0]).not.toHaveProperty('owner_type')
    expect(updatePayloads[0]).not.toHaveProperty('org_id')
  })
})

describe('registerOrgChannelAccount: 並行初回登録のレース（23505）', () => {
  it('INSERT が active一意index違反(23505)なら既存を再取得してローテートする', async () => {
    const existingCredRow = {
      id: 'acc-winner',
      org_id: ORG,
      display_name: 'x',
      credentials_encrypted: 'OLD_ENC',
      status: 'active',
      owner_type: 'org',
      channel: 'telegram',
    }
    fromQueue['channel_accounts'] = [
      { data: null, error: null }, // find reusable → 無し（このタイミングでは未作成）
      { data: null, error: { code: '23505', message: 'duplicate' } }, // insert 敗北
      { data: { id: 'acc-winner' }, error: null }, // 再find reusable → 勝者
      { data: existingCredRow, error: null }, // findChannelAccountCredentials
      { data: newAccountRow({ id: 'acc-winner' }), error: null }, // update 結果
    ]
    rpcResponses['decrypt_system_secret'] = {
      data: JSON.stringify({ bot_token: 'winner', webhook_secret: 'whsec_WIN' }),
      error: null,
    }

    const result = await store.registerOrgChannelAccount({
      orgId: ORG,
      channel: 'telegram',
      displayName: 'loser',
      operatorCredentials: { bot_token: 'loser' },
      generatedCredentials: { webhook_secret: 'whsec_loser' },
    })
    expect(result.created).toBe(false)
    expect(result.account.id).toBe('acc-winner')
    // 勝者の webhook_secret を維持（敗者の値で上書きしない）
    expect(result.generatedSecrets).toEqual({ webhook_secret: 'whsec_WIN' })
  })
})

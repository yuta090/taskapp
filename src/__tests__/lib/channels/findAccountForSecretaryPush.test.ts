import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findAccountForSecretaryPush の必須資格情報チェック（PR-f）。
 *
 * Google Chat は platform（当社所有の共有bot）だと SA(サービスアカウント)認証のみで送る
 * （env GOOGLE_CHAT_SA_KEY・DB資格情報に webhook_url は無い・持たせない設計）。
 * 従来は SECRETARY_PUSH_REQUIRED_CREDENTIALS.google_chat = ['webhook_url'] を一律適用していたため、
 * platform google_chat アカウントは missing_credential で朝の報告(digest)送信が弾かれていた。
 * → google_chat かつ owner_type='platform' のときだけ必須チェックをスキップする。
 * org所有(webhook_url必須)・他チャネルの判定は不変であること（回帰）も確認する。
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

function accountRow(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    org_id: null,
    display_name: 'test',
    credentials_encrypted: 'enc-blob',
    status: 'active',
    owner_type: 'platform',
    channel: 'google_chat',
    ...over,
  }
}

function setCredentials(json: Record<string, unknown>) {
  rpcResponses.decrypt_system_secret = { data: JSON.stringify(json), error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  fromResponses = {}
  rpcResponses = {
    decrypt_system_secret: { data: JSON.stringify({}), error: null },
  }
  fromMock.mockImplementation((table: string) => chain(fromResponses[table] ?? { data: null, error: null }))
  rpcMock.mockImplementation((fn: string) => Promise.resolve(rpcResponses[fn] ?? { data: null, error: null }))
})

describe('findAccountForSecretaryPush: google_chat の owner_type分岐', () => {
  it('platform google_chat は webhook_url が無くても ok:true（SA経路・PR-f）', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ owner_type: 'platform' }),
      error: null,
    }
    setCredentials({ note: 'SA key is provided via env (not stored in DB)' })

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: true, ownerType: 'platform', channel: 'google_chat' })
  })

  it('org google_chat は webhook_url が無ければ従来どおり missing_credential（現行のまま不変）', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ owner_type: 'org', org_id: 'org-1' }),
      error: null,
    }
    setCredentials({})

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('webhook_url') })
  })

  it('org google_chat は webhook_url があれば ok:true', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ owner_type: 'org', org_id: 'org-1' }),
      error: null,
    }
    setCredentials({ webhook_url: 'https://chat.googleapis.com/v1/spaces/x' })

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: true, ownerType: 'org', channel: 'google_chat' })
  })
})

describe('findAccountForSecretaryPush: 他チャネルの判定は不変（回帰）', () => {
  it('line: 資格情報欠落は従来どおり missing_credential', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ channel: 'line', owner_type: 'platform' }),
      error: null,
    }
    setCredentials({})

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('channel_secret') })
  })

  it('discord platform: bot_token があれば ok:true（いずれか方式・変更なし）', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ channel: 'discord', owner_type: 'platform' }),
      error: null,
    }
    setCredentials({ bot_token: 'BOT-TOKEN' })

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: true, ownerType: 'platform', channel: 'discord' })
  })

  it('discord platform: bot_tokenもwebhook_urlも無ければ missing_credential（変更なし）', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ channel: 'discord', owner_type: 'platform' }),
      error: null,
    }
    setCredentials({})

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('bot_token or webhook_url') })
  })

  it('slack: bot_token が無ければ missing_credential（platformでも特例なし）', async () => {
    fromResponses['channel_accounts'] = {
      data: accountRow({ channel: 'slack', owner_type: 'platform' }),
      error: null,
    }
    setCredentials({})

    const result = await store.findAccountForSecretaryPush('acc-1')
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('bot_token') })
  })
})

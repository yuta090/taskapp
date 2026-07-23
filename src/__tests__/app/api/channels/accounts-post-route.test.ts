import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/accounts — 非LINEチャットチャネルの資格情報登録（作成/ローテート）。
 *
 * - owner/admin のみ（requireOrgAdmin）。org_id/owner_type はサーバー側で固定（platformを作らせない）。
 * - own_line_account（Pro専有）ゲート: 自社アカウント（白ラベル）を繋ぐのは Pro 限定 → Freeは402。
 * - registry 必須フィールド（generated/optional を除く）の欠落は400。
 * - サーバー生成フィールド（telegram.webhook_secret）は生成して credentials に含め、一度だけ返す。
 * - LINE / planned / 非outbound は拒否。
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const storeMock = {
  registerOrgChannelAccount: vi.fn(),
  generateChannelWebhookSecret: vi.fn(() => 'whsec_generated'),
}
vi.mock('@/lib/channels/store', () => storeMock)

const resolveEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveEntitlementsMock(...args),
}))

const fetchChatworkAccountIdMock = vi.fn()
vi.mock('@/lib/channels/chatwork/client', () => ({
  fetchChatworkAccountId: (...args: unknown[]) => fetchChatworkAccountIdMock(...args),
}))

const verifySlackTokenMock = vi.fn()
vi.mock('@/lib/channels/slack/probe', () => ({
  verifySlackToken: (...args: unknown[]) => verifySlackTokenMock(...args),
}))

const verifyTelegramTokenMock = vi.fn()
vi.mock('@/lib/channels/telegram/probe', () => ({
  verifyTelegramToken: (...args: unknown[]) => verifyTelegramTokenMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const { POST } = await import('@/app/api/channels/accounts/route')

function entitled(has: boolean) {
  return { planId: has ? 'pro' : 'free', has: () => has }
}

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'

function accountMeta(over: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    orgId: ORG_A,
    channel: 'telegram',
    displayName: 'テレグラム秘書',
    lineBotUserId: null,
    status: 'active' as const,
    createdAt: '2026-07-20T00:00:00.000Z',
    ownerType: 'org' as const,
    ...over,
  }
}

function callPost(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  resolveEntitlementsMock.mockResolvedValue(entitled(true))
  fetchChatworkAccountIdMock.mockResolvedValue('363')
  verifySlackTokenMock.mockResolvedValue({ ok: true, botUserId: 'Ubot0000' })
  verifyTelegramTokenMock.mockResolvedValue({ ok: true, botUsername: 'my_bot', botId: '123456' })
  storeMock.generateChannelWebhookSecret.mockReturnValue('whsec_generated')
  storeMock.registerOrgChannelAccount.mockResolvedValue({
    account: accountMeta(),
    created: true,
    generatedSecrets: { webhook_secret: 'whsec_generated' },
  })
})

describe('POST /api/channels/accounts — 入力検証', () => {
  it('不正JSONは400', async () => {
    const req = new NextRequest('http://localhost:3000/api/channels/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('orgId不正は400', async () => {
    expect((await callPost({ orgId: 'nope', channel: 'telegram', credentials: {} })).status).toBe(400)
  })

  it('未知チャネルは400', async () => {
    const res = await callPost({ orgId: ORG_A, channel: 'myspace', credentials: {} })
    expect(res.status).toBe(400)
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('LINEは専用フローへ誘導（400 line_dedicated_flow）', async () => {
    const res = await callPost({ orgId: ORG_A, channel: 'line', credentials: {} })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('line_dedicated_flow')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('planned チャネル(messenger)は接続不可400', async () => {
    const res = await callPost({ orgId: ORG_A, channel: 'messenger', credentials: {} })
    expect(res.status).toBe(400)
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })
})

describe('POST /api/channels/accounts — 認可 / Proゲート', () => {
  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })).status).toBe(401)
  })

  it('member(owner/adminでない)は403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    expect(res.status).toBe(403)
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('Free org は 402 own_line_account_required（自社アカウント接続はPro）', async () => {
    resolveEntitlementsMock.mockResolvedValue(entitled(false))
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('own_line_account_required')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })
})

describe('POST /api/channels/accounts — 資格情報検証', () => {
  it('必須フィールド(bot_token)欠落は400 missing_credential', async () => {
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: {} })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('missing_credential')
    expect(json.field).toBe('bot_token')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('空白のみの必須フィールドは400', async () => {
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: '   ' } })
    expect(res.status).toBe(400)
  })

  it('optional フィールド(chatwork.webhook_token)欠落でも登録できる', async () => {
    storeMock.registerOrgChannelAccount.mockResolvedValue({
      account: accountMeta({ channel: 'chatwork' }),
      created: true,
      generatedSecrets: {},
    })
    const res = await callPost({ orgId: ORG_A, channel: 'chatwork', credentials: { api_token: 'tok' } })
    expect(res.status).toBe(201)
    expect(storeMock.registerOrgChannelAccount).toHaveBeenCalled()
  })
})

describe('POST /api/channels/accounts — Chatwork bot_account_id 解決（自己ループ防止）', () => {
  beforeEach(() => {
    storeMock.registerOrgChannelAccount.mockResolvedValue({
      account: accountMeta({ channel: 'chatwork' }),
      created: true,
      generatedSecrets: {},
    })
  })

  it('登録時に /me で bot 自身の account_id を解決し operatorCredentials に注入する', async () => {
    fetchChatworkAccountIdMock.mockResolvedValue('363')
    const res = await callPost({ orgId: ORG_A, channel: 'chatwork', credentials: { api_token: 'tok' } })
    expect(res.status).toBe(201)
    expect(fetchChatworkAccountIdMock).toHaveBeenCalledWith('tok')
    const arg = storeMock.registerOrgChannelAccount.mock.calls[0][0]
    expect(arg.operatorCredentials).toMatchObject({ api_token: 'tok', bot_account_id: '363' })
  })

  it('api_token が無効(解決null)なら400 chatwork_token_unverified・登録しない', async () => {
    fetchChatworkAccountIdMock.mockResolvedValue(null)
    const res = await callPost({ orgId: ORG_A, channel: 'chatwork', credentials: { api_token: 'bad' } })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('chatwork_token_unverified')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('telegram登録では /me 解決を呼ばない（チャネル固有処理）', async () => {
    await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    expect(fetchChatworkAccountIdMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/channels/accounts — Slack bot_user_id 解決＋scope検証（自己ループ防止）', () => {
  beforeEach(() => {
    storeMock.registerOrgChannelAccount.mockResolvedValue({
      account: accountMeta({ channel: 'slack' }),
      created: true,
      generatedSecrets: {},
    })
  })

  it('登録時にauth.testでbot自身のuser_idを解決しoperatorCredentialsに注入する', async () => {
    verifySlackTokenMock.mockResolvedValue({ ok: true, botUserId: 'Ubot0000' })
    const res = await callPost({
      orgId: ORG_A,
      channel: 'slack',
      credentials: { bot_token: 'xoxb-1', signing_secret: 'sig' },
    })
    expect(res.status).toBe(201)
    expect(verifySlackTokenMock).toHaveBeenCalledWith('xoxb-1')
    const arg = storeMock.registerOrgChannelAccount.mock.calls[0][0]
    expect(arg.operatorCredentials).toMatchObject({
      bot_token: 'xoxb-1',
      signing_secret: 'sig',
      bot_user_id: 'Ubot0000',
    })
  })

  it('bot_tokenが無効(token_unverified)なら400 slack_token_unverified・登録しない', async () => {
    verifySlackTokenMock.mockResolvedValue({ ok: false, code: 'slack_token_unverified' })
    const res = await callPost({
      orgId: ORG_A,
      channel: 'slack',
      credentials: { bot_token: 'bad', signing_secret: 'sig' },
    })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('slack_token_unverified')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('必要scope不足(missing_scope)なら400 slack_missing_scope・不足scope名を含む・登録しない', async () => {
    verifySlackTokenMock.mockResolvedValue({
      ok: false,
      code: 'slack_missing_scope',
      detail: 'chat:write',
    })
    const res = await callPost({
      orgId: ORG_A,
      channel: 'slack',
      credentials: { bot_token: 'xoxb-1', signing_secret: 'sig' },
    })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('slack_missing_scope')
    expect(json.error).toContain('chat:write')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('telegram登録ではauth.test検証を呼ばない（チャネル固有処理）', async () => {
    await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    expect(verifySlackTokenMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/channels/accounts — Telegram bot_username解決＋privacy mode検証（拾い漏れ防止）', () => {
  it('登録時にgetMeでbot自身のusername/idを解決しoperatorCredentialsに注入する', async () => {
    verifyTelegramTokenMock.mockResolvedValue({ ok: true, botUsername: 'my_bot', botId: '123456' })
    const res = await callPost({
      orgId: ORG_A,
      channel: 'telegram',
      credentials: { bot_token: '123:abc' },
    })
    expect(res.status).toBe(201)
    expect(verifyTelegramTokenMock).toHaveBeenCalledWith('123:abc')
    const arg = storeMock.registerOrgChannelAccount.mock.calls[0][0]
    expect(arg.operatorCredentials).toMatchObject({
      bot_token: '123:abc',
      bot_username: 'my_bot',
      bot_id: '123456',
    })
  })

  it('bot_tokenが無効(token_unverified)なら400 telegram_token_unverified・登録しない', async () => {
    verifyTelegramTokenMock.mockResolvedValue({ ok: false, code: 'telegram_token_unverified' })
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 'bad' } })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('telegram_token_unverified')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('privacy mode有効(グループ全発言を読めない)なら400 telegram_privacy_mode・登録しない', async () => {
    verifyTelegramTokenMock.mockResolvedValue({ ok: false, code: 'telegram_privacy_mode' })
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('telegram_privacy_mode')
    expect(storeMock.registerOrgChannelAccount).not.toHaveBeenCalled()
  })

  it('slack登録ではgetMe検証を呼ばない（チャネル固有処理）', async () => {
    storeMock.registerOrgChannelAccount.mockResolvedValue({
      account: accountMeta({ channel: 'slack' }),
      created: true,
      generatedSecrets: {},
    })
    await callPost({
      orgId: ORG_A,
      channel: 'slack',
      credentials: { bot_token: 'xoxb-1', signing_secret: 'sig' },
    })
    expect(verifyTelegramTokenMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/channels/accounts — 登録成功', () => {
  it('Telegram: webhook_secret を生成し、accountId込みの受信Webhook URLを返す', async () => {
    const res = await callPost({
      orgId: ORG_A,
      channel: 'telegram',
      displayName: 'テレグラム秘書',
      credentials: { bot_token: '123:abc' },
    })
    const json = await res.json()

    expect(res.status).toBe(201)
    // store には operator+generated を分けて渡す
    // （bot_username/bot_id はgetMeプローブが解決してoperatorCredentialsに注入したもの）
    const arg = storeMock.registerOrgChannelAccount.mock.calls[0][0]
    expect(arg.operatorCredentials).toEqual({
      bot_token: '123:abc',
      bot_username: 'my_bot',
      bot_id: '123456',
    })
    expect(arg.generatedCredentials).toEqual({ webhook_secret: 'whsec_generated' })
    expect(arg.owner_type).toBeUndefined() // owner_type はstore側で固定（route から渡さない）

    // 生成secretは一度だけ返す
    expect(json.generatedSecrets).toEqual({ webhook_secret: 'whsec_generated' })
    // {accountId} が実IDへ解決される
    expect(json.webhookUrl).toBe(`http://localhost:3000/api/channels/telegram/webhook/${ACCOUNT_ID}`)
    expect(json.account.id).toBe(ACCOUNT_ID)
    // 資格情報の平文/暗号文はワイヤに出さない
    expect(json.account.credentials).toBeUndefined()
    expect(json.account.credentials_encrypted).toBeUndefined()
  })

  it('生成フィールドの無いチャネル(slack)は generatedSecrets 空・webhookUrlはパス解決', async () => {
    storeMock.registerOrgChannelAccount.mockResolvedValue({
      account: accountMeta({ channel: 'slack' }),
      created: true,
      generatedSecrets: {},
    })
    const res = await callPost({
      orgId: ORG_A,
      channel: 'slack',
      credentials: { bot_token: 'xoxb-1', signing_secret: 'sig' },
    })
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.generatedSecrets).toEqual({})
    expect(storeMock.generateChannelWebhookSecret).not.toHaveBeenCalled()
    // slack も account単位の受信URL（{accountId} が実IDへ解決される）
    expect(json.webhookUrl).toBe(
      `http://localhost:3000/api/channels/slack/webhook/${ACCOUNT_ID}`,
    )
  })

  it('既存アカウントのローテートは created=false・200', async () => {
    storeMock.registerOrgChannelAccount.mockResolvedValue({
      account: accountMeta(),
      created: false,
      generatedSecrets: { webhook_secret: 'whsec_generated' },
    })
    const res = await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.created).toBe(false)
  })

  it('displayName未指定なら registry の label で登録する', async () => {
    await callPost({ orgId: ORG_A, channel: 'telegram', credentials: { bot_token: 't' } })
    const arg = storeMock.registerOrgChannelAccount.mock.calls[0][0]
    expect(arg.displayName).toBe('Telegram')
  })
})

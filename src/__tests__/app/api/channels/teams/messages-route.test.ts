import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/teams/messages — Bearer JWT 検証（★SSRF防御のserviceurl突合込み）→
 * handler へ委譲。handler本体は webhookHandler.test.ts で網羅するため、ここは認証境界・
 * JSONパース順序・配線のみ検証する。
 */
const verifyTeamsActivityRequestMock = vi.fn()
vi.mock('@/lib/channels/teams/jwtVerify', () => ({
  verifyTeamsActivityRequest: (...a: unknown[]) => verifyTeamsActivityRequestMock(...a),
}))

const handleTeamsWebhookMock = vi.fn()
vi.mock('@/lib/channels/teams/webhookHandler', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, handleTeamsWebhook: (...a: unknown[]) => handleTeamsWebhookMock(...a) }
})
// store/entitlements/admin は deps 構築時に参照されるだけ（handler mock で未実行）。
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const sendTeamsReplyMock = vi.fn()
const getAppTokenMock = vi.fn()
vi.mock('@/lib/channels/teams/connectorClient', () => ({
  sendTeamsReply: (...a: unknown[]) => sendTeamsReplyMock(...a),
  getAppToken: (...a: unknown[]) => getAppTokenMock(...a),
}))

const { POST } = await import('@/app/api/channels/teams/messages/route')

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/teams/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  )
}

const MESSAGE_ACTIVITY = JSON.stringify({
  type: 'message',
  id: 'act-1',
  text: 'GC-CODE',
  serviceUrl: 'https://smba.trafficmanager.net/amer/',
  channelData: { channel: { id: '19:abcd@thread.tacv2' } },
  conversation: { id: '19:abcd@thread.tacv2;messageid=1' },
  from: { id: '29:user-1' },
})

const ORIGINAL_APP_ID = process.env.TEAMS_BOT_APP_ID
const ORIGINAL_APP_PASSWORD = process.env.TEAMS_BOT_APP_PASSWORD

beforeEach(() => {
  vi.clearAllMocks()
  verifyTeamsActivityRequestMock.mockResolvedValue({
    ok: true,
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
  })
  handleTeamsWebhookMock.mockResolvedValue(undefined)
  sendTeamsReplyMock.mockResolvedValue({ ok: true })
  getAppTokenMock.mockResolvedValue('app-token-1')
})

afterEach(() => {
  if (ORIGINAL_APP_ID === undefined) delete process.env.TEAMS_BOT_APP_ID
  else process.env.TEAMS_BOT_APP_ID = ORIGINAL_APP_ID
  if (ORIGINAL_APP_PASSWORD === undefined) delete process.env.TEAMS_BOT_APP_PASSWORD
  else process.env.TEAMS_BOT_APP_PASSWORD = ORIGINAL_APP_PASSWORD
})

describe('POST /api/channels/teams/messages', () => {
  it('検証成功・message activityはhandlerへ委譲し空の200を返す', async () => {
    const res = await post(MESSAGE_ACTIVITY, { authorization: 'Bearer good-token' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({})
    expect(handleTeamsWebhookMock).toHaveBeenCalledTimes(1)
    expect(handleTeamsWebhookMock.mock.calls[0][0]).toMatchObject({
      externalGroupId: '19:abcd@thread.tacv2',
      text: 'GC-CODE',
    })
  })

  it('JWT検証には認証ヘッダとactivity.serviceUrlの両方が渡る（SSRF防御の突合用）', async () => {
    await post(MESSAGE_ACTIVITY, { authorization: 'Bearer good-token' })
    expect(verifyTeamsActivityRequestMock).toHaveBeenCalledWith(
      'Bearer good-token',
      'https://smba.trafficmanager.net/amer/',
    )
  })

  it('conversationUpdate等の非messageはhandlerを呼ばず空の200を返す', async () => {
    const body = JSON.stringify({ type: 'conversationUpdate', serviceUrl: 'https://x/' })
    const res = await post(body, { authorization: 'Bearer good-token' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({})
    expect(handleTeamsWebhookMock).not.toHaveBeenCalled()
  })

  it('env_missing は 500（fail-closed・handlerを呼ばない）', async () => {
    verifyTeamsActivityRequestMock.mockResolvedValue({ ok: false, reason: 'env_missing' })
    const res = await post(MESSAGE_ACTIVITY, { authorization: 'Bearer x' })
    expect(res.status).toBe(500)
    expect(handleTeamsWebhookMock).not.toHaveBeenCalled()
  })

  it('no_token は 401', async () => {
    verifyTeamsActivityRequestMock.mockResolvedValue({ ok: false, reason: 'no_token' })
    const res = await post(MESSAGE_ACTIVITY)
    expect(res.status).toBe(401)
    expect(handleTeamsWebhookMock).not.toHaveBeenCalled()
  })

  it('invalid（serviceurl不一致含む）は401', async () => {
    verifyTeamsActivityRequestMock.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res = await post(MESSAGE_ACTIVITY, { authorization: 'Bearer bad' })
    expect(res.status).toBe(401)
    expect(handleTeamsWebhookMock).not.toHaveBeenCalled()
  })

  it('不正JSONは検証結果を問わず400（JSON parseがverifyより先）', async () => {
    const res = await post('{bad', { authorization: 'Bearer good-token' })
    expect(res.status).toBe(400)
    expect(verifyTeamsActivityRequestMock).not.toHaveBeenCalled()
    expect(handleTeamsWebhookMock).not.toHaveBeenCalled()
  })

  it('handlerが例外を投げたら500', async () => {
    handleTeamsWebhookMock.mockRejectedValue(new Error('boom'))
    const res = await post(MESSAGE_ACTIVITY, { authorization: 'Bearer good-token' })
    expect(res.status).toBe(500)
  })

  // ---------------------------------------------------------------------------
  // 再現テスト（ブロッカー修正）: JSON.parse は "null"/数値/文字列/真偽値を例外無しで返すため、
  // オブジェクト検証を挟まないと直後の activity.serviceUrl アクセスで未捕捉500になっていた。
  // 非オブジェクトは一律400・verifyは呼ばれない。
  // ---------------------------------------------------------------------------
  describe('非オブジェクトのボディ（null/文字列/数値/真偽値）', () => {
    it.each([
      ['null', 'null'],
      ['文字列', '"str"'],
      ['数値', '123'],
      ['真偽値', 'false'],
    ])('%s は400・verifyは呼ばれない', async (_label, body) => {
      const res = await post(body, { authorization: 'Bearer good-token' })
      expect(res.status).toBe(400)
      expect(verifyTeamsActivityRequestMock).not.toHaveBeenCalled()
      expect(handleTeamsWebhookMock).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // SSRF防御の正本一本化: Connectorへの送信先は検証済みのverification.serviceUrlを使う
  // （生のactivity.serviceUrlではない）。
  // ---------------------------------------------------------------------------
  it('reply経由の送信先には検証済みのverification.serviceUrlが使われる（生のactivity.serviceUrlではない）', async () => {
    const VERIFIED_URL = 'https://smba.trafficmanager.net/verified-by-jwt/'
    verifyTeamsActivityRequestMock.mockResolvedValue({ ok: true, serviceUrl: VERIFIED_URL })
    process.env.TEAMS_BOT_APP_ID = 'app-id-1'
    process.env.TEAMS_BOT_APP_PASSWORD = 'app-pw-1'

    handleTeamsWebhookMock.mockImplementation(
      async (_activity: unknown, deps: { reply: (text: string) => Promise<void> }) => {
        await deps.reply('このチャンネルを登録しました。')
      },
    )

    await post(MESSAGE_ACTIVITY, { authorization: 'Bearer good-token' })

    expect(sendTeamsReplyMock).toHaveBeenCalledTimes(1)
    const [params] = sendTeamsReplyMock.mock.calls[0]
    // MESSAGE_ACTIVITY の生の serviceUrl (amer/) ではなく、verify が返した VERIFIED_URL が使われる。
    expect(params.serviceUrl).toBe(VERIFIED_URL)
    expect(params.serviceUrl).not.toBe('https://smba.trafficmanager.net/amer/')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'node:crypto'

/**
 * POST /api/channels/slack/webhook/org/[orgId] — 組織単位の Slack 受信URL。
 *
 * 目的: 利用者が Slack アプリを作る「前」に受信URLを確定させ、AgentPM が用意した設定ファイルに
 * 埋め込めるようにする（account 単位URLだと登録後にしか分からず、Slack と AgentPM を往復させていた）。
 *
 * - アプリ未登録（org の自社 Slack account が無い）: Slack の URL 確認（url_verification）だけは
 *   challenge を返す。これは Slack が「このURLは本当にあなたのものか」を確かめる公開の手続きで、
 *   秘密情報を含まない。それ以外は 401。
 * - 登録済み: その account の signing_secret で署名検証し、account 単位URLと同じ処理に委ねる。
 */

const ORG = '322a219f-1a73-4935-b061-08b8a5e97334'
const ACCOUNT = 'e5ae6e9b-38b6-4b76-8607-a61d4e6260ec'
const SECRET = 'a2134a-test-secret'

const findActiveOrgAccountIdMock = vi.fn()
const handleSlackWebhookMock = vi.fn()

vi.mock('@/lib/channels/store', () => ({
  findActiveOrgAccountId: (...args: unknown[]) => findActiveOrgAccountIdMock(...args),
  MultipleOrgAccountsError: class extends Error {},
}))
const afterMock = vi.fn()
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // 本物の after() はリクエスト文脈が要る。ここでは「登録された関数」を捕まえて後で実行する
  after: (fn: () => unknown) => afterMock(fn),
}))
vi.mock('@/lib/channels/slack/webhookDeps', () => ({ slackWebhookDeps: { marker: 'deps' } }))
vi.mock('@/lib/channels/slack/webhookHandler', () => ({
  handleSlackWebhook: (...args: unknown[]) => handleSlackWebhookMock(...args),
  isSlackInteractionBody: (rawBody: string) => rawBody.startsWith('payload='),
}))

const { POST } = await import('@/app/api/channels/slack/webhook/org/[orgId]/route')

function sign(rawBody: string, ts: string, secret = SECRET) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')
}

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(`https://agentpm.app/api/channels/slack/webhook/org/${ORG}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    }),
    { params: Promise.resolve({ orgId: ORG }) },
  )
}

describe('POST /api/channels/slack/webhook/org/[orgId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handleSlackWebhookMock.mockResolvedValue({ status: 200, body: { ok: true } })
  })

  it('未登録の org でも url_verification には challenge を返す（アプリ作成時の URL 確認を通す）', async () => {
    findActiveOrgAccountIdMock.mockResolvedValue(null)
    const res = await post(JSON.stringify({ type: 'url_verification', challenge: 'abc123' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'abc123' })
    expect(handleSlackWebhookMock).not.toHaveBeenCalled()
  })

  it('未登録の org への通常イベントは 401（解釈しない・保存しない）', async () => {
    findActiveOrgAccountIdMock.mockResolvedValue(null)
    const res = await post(JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'x' } }))
    expect(res.status).toBe(401)
    expect(handleSlackWebhookMock).not.toHaveBeenCalled()
  })

  it('登録済みなら、その account の処理（署名検証込み）に委ねる', async () => {
    findActiveOrgAccountIdMock.mockResolvedValue(ACCOUNT)
    const body = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'hello' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await post(body, { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts })
    expect(res.status).toBe(200)
    expect(findActiveOrgAccountIdMock).toHaveBeenCalledWith(ORG, 'slack')
    expect(handleSlackWebhookMock).toHaveBeenCalledTimes(1)
    const [accountId, rawBody, auth, deps] = handleSlackWebhookMock.mock.calls[0] as unknown as [
      string,
      string,
      { signature: string | null; timestamp: string | null; nowSeconds: number },
      unknown,
    ]
    expect(accountId).toBe(ACCOUNT)
    expect(rawBody).toBe(body)
    expect(auth.signature).toBe(sign(body, ts))
    expect(auth.timestamp).toBe(ts)
    expect(deps).toEqual({ marker: 'deps' })
  })

  it('不正な orgId は 400', async () => {
    const res = await POST(
      new NextRequest('https://agentpm.app/api/channels/slack/webhook/org/not-a-uuid', {
        method: 'POST',
        body: '{}',
      }),
      { params: Promise.resolve({ orgId: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(400)
    expect(findActiveOrgAccountIdMock).not.toHaveBeenCalled()
  })
})


describe('ボタン押下（Interactivity）は先に 200 を返してから処理する', () => {
  beforeEach(() => {
    afterMock.mockReset()
    findActiveOrgAccountIdMock.mockResolvedValue(ACCOUNT)
    handleSlackWebhookMock.mockResolvedValue({ status: 200, body: null })
  })

  it('payload= のフォーム本文は、空ボディ 200 を即返し、処理は after() に回す（Slack の3秒制約）', async () => {
    const body = `payload=${encodeURIComponent(JSON.stringify({ type: 'block_actions', actions: [] }))}`
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await post(body, { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    // 応答時点ではまだ処理していない。after() に登録した関数が処理本体を呼ぶ
    expect(handleSlackWebhookMock).not.toHaveBeenCalled()
    expect(afterMock).toHaveBeenCalledTimes(1)
    await afterMock.mock.calls[0][0]()
    expect(handleSlackWebhookMock).toHaveBeenCalledTimes(1)
    const [accountId, rawBody, auth] = handleSlackWebhookMock.mock.calls[0]
    expect(accountId).toBe(ACCOUNT)
    expect(rawBody).toBe(body)
    expect(auth.signature).toBe(sign(body, ts))
  })

  it('処理結果の body が null（イベント経路で空応答を選んだとき）は空ボディで返す', async () => {
    handleSlackWebhookMock.mockResolvedValue({ status: 200, body: null })
    const body = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'hello' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await post(body, { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})

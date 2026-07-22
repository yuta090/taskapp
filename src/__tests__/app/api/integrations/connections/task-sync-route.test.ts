import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/integrations/connections/task-sync — APIキー方式のタスク同期接続の作成。
 *
 * ここで固定したい境界:
 *   - 認可（owner/admin のみ。鍵を預かる操作だから）
 *   - 接続先の検証（アダプタ宣言の hostPolicy に従う。any-https だけIP検査も通す）
 *   - 保存前の鍵検証（間違った鍵を保存させない）
 *   - 鍵は暗号化列にのみ入れ、平文列には残さない
 *   - 二重接続は 409（同じ外部テナントへ二重に繋ぐと二重取り込みになる）
 */

const requireOrgAdmin = vi.fn()
const validateWebhookUrl = vi.fn()
const encryptToken = vi.fn()
const getTaskSyncAdapter = vi.fn()
const insertCapture: Record<string, unknown> = {}
let insertError: unknown = null

vi.mock('@/lib/channels/authz', () => ({ requireOrgAdmin: (...a: unknown[]) => requireOrgAdmin(...a) }))
vi.mock('@/lib/sinks/ssrf', () => ({ validateWebhookUrl: (...a: unknown[]) => validateWebhookUrl(...a) }))
vi.mock('@/lib/integrations/token-crypto', () => ({ encryptToken: (...a: unknown[]) => encryptToken(...a) }))
vi.mock('@/lib/task-sync/adapters', () => ({ getTaskSyncAdapter: (...a: unknown[]) => getTaskSyncAdapter(...a) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        Object.assign(insertCapture, payload)
        return {
          select: () => ({
            single: async () => ({ data: insertError ? null : { id: 'conn-new' }, error: insertError }),
          }),
        }
      },
    }),
  }),
}))

const { POST } = await import('@/app/api/integrations/connections/task-sync/route')

const ORG_ID = '11111111-1111-1111-1111-111111111111'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/integrations/connections/task-sync', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function adapter(over: Record<string, unknown> = {}) {
  return {
    id: 'backlog',
    authKind: 'api_key',
    hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.backlog.jp'] },
    listContainers: vi.fn().mockResolvedValue([{ id: '1', title: 'p' }]),
    ...over,
  }
}

beforeEach(() => {
  for (const k of Object.keys(insertCapture)) delete insertCapture[k]
  insertError = null
  requireOrgAdmin.mockReset().mockResolvedValue({ ok: true })
  validateWebhookUrl.mockReset().mockResolvedValue({ ok: true })
  encryptToken.mockReset().mockResolvedValue('encrypted-key')
  getTaskSyncAdapter.mockReset().mockReturnValue(adapter())
})

describe('認可', () => {
  it('owner/admin でなければ作成できない', async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
    const res = await POST(req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k', base_url: 'https://e.backlog.jp' }))
    expect(res.status).toBe(403)
  })
})

describe('対象ツールの検証', () => {
  it('アダプタ未実装の provider は拒否する（DBのprovider列は形式チェックのみなのでここが門番）', async () => {
    getTaskSyncAdapter.mockReturnValue(null)
    const res = await POST(req({ org_id: ORG_ID, provider: 'unknown_tool', api_key: 'k' }))
    expect(res.status).toBe(400)
  })

  it('OAuthのツールはこの経路では作らせない（同意画面の別経路があるため）', async () => {
    getTaskSyncAdapter.mockReturnValue(adapter({ authKind: 'oauth' }))
    const res = await POST(req({ org_id: ORG_ID, provider: 'wrike', api_key: 'k' }))
    expect(res.status).toBe(400)
  })
})

describe('接続先URLの検証', () => {
  it('ベンダードメイン外のURLは拒否する（鍵を他所へ送らない）', async () => {
    const res = await POST(
      req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k', base_url: 'https://evil.example.com' }),
    )
    expect(res.status).toBe(400)
  })

  it('接続先URLが要るツールで未入力なら拒否する', async () => {
    const res = await POST(req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k' }))
    expect(res.status).toBe(400)
  })

  it('自ホスト型(any-https)はIP検査も通す（許可リストで守れないため）', async () => {
    getTaskSyncAdapter.mockReturnValue(adapter({ id: 'redmine', hostPolicy: { kind: 'any-https' } }))
    validateWebhookUrl.mockResolvedValue({ ok: false, reason: 'private address' })
    const res = await POST(
      req({ org_id: ORG_ID, provider: 'redmine', api_key: 'k', base_url: 'https://redmine.internal' }),
    )
    expect(res.status).toBe(400)
    expect(validateWebhookUrl).toHaveBeenCalled()
  })

  it('固定ホストのツールは接続先URLを要求しない', async () => {
    getTaskSyncAdapter.mockReturnValue(adapter({ id: 'trello', hostPolicy: { kind: 'fixed', host: 'api.trello.com' } }))
    const res = await POST(req({ org_id: ORG_ID, provider: 'trello', api_key: 'k' }))
    expect(res.status).toBe(201)
    expect(insertCapture.base_url).toBeNull()
    // 固定ホスト＝1org1接続のまま（複数接続を開くと同じデータを二重に取り込むだけ）。
    expect(insertCapture.external_account_key).toBeNull()
  })
})

describe('鍵の検証', () => {
  it('保存前に外部APIを1回叩き、認証エラーなら保存しない', async () => {
    const failing = adapter()
    const err = Object.assign(new Error('unauthorized'), { status: 401 })
    failing.listContainers = vi.fn().mockRejectedValue(err)
    getTaskSyncAdapter.mockReturnValue(failing)

    const res = await POST(
      req({ org_id: ORG_ID, provider: 'backlog', api_key: 'wrong', base_url: 'https://e.backlog.jp' }),
    )
    expect(res.status).toBe(400)
    expect(insertCapture.provider).toBeUndefined() // insert されていない
  })

  it('相手側の一時障害は 502（設定は正しいかもしれないので保存もしないし失敗扱いにもしない）', async () => {
    const failing = adapter()
    failing.listContainers = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    getTaskSyncAdapter.mockReturnValue(failing)
    const res = await POST(
      req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k', base_url: 'https://e.backlog.jp' }),
    )
    expect(res.status).toBe(502)
  })
})

describe('kintone: アプリID(kintone_app_ids)が1件も無い接続は作らせない(死んだ接続防止)', () => {
  it('kintone_app_idsが未指定なら400で拒否する(保存前に落とす)', async () => {
    getTaskSyncAdapter.mockReturnValue(adapter({ id: 'kintone', hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.cybozu.com'] } }))
    const res = await POST(
      req({ org_id: ORG_ID, provider: 'kintone', api_key: 'k', base_url: 'https://e.cybozu.com' }),
    )
    expect(res.status).toBe(400)
    expect(insertCapture.provider).toBeUndefined()
  })

  it('kintone_app_idsが空配列なら400で拒否する', async () => {
    getTaskSyncAdapter.mockReturnValue(adapter({ id: 'kintone', hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.cybozu.com'] } }))
    const res = await POST(
      req({
        org_id: ORG_ID,
        provider: 'kintone',
        api_key: 'k',
        base_url: 'https://e.cybozu.com',
        provider_config: { kintone_app_ids: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('kintone_app_idsが不正な値だけ(数値以外の文字列等)でも実質空扱いで400にする', async () => {
    getTaskSyncAdapter.mockReturnValue(adapter({ id: 'kintone', hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.cybozu.com'] } }))
    const res = await POST(
      req({
        org_id: ORG_ID,
        provider: 'kintone',
        api_key: 'k',
        base_url: 'https://e.cybozu.com',
        provider_config: { kintone_app_ids: ['not-a-number', ''] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('kintone_app_idsが1件以上あれば作成できる', async () => {
    const a = adapter({ id: 'kintone', hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.cybozu.com'] } })
    getTaskSyncAdapter.mockReturnValue(a)
    const res = await POST(
      req({
        org_id: ORG_ID,
        provider: 'kintone',
        api_key: 'k',
        base_url: 'https://e.cybozu.com',
        provider_config: { kintone_app_ids: ['5', '9'] },
      }),
    )
    expect(res.status).toBe(201)
    expect(a.listContainers).toHaveBeenCalledWith(
      expect.objectContaining({ config: { kintone_app_ids: ['5', '9'] } }),
    )
  })
})

describe('保存', () => {
  it('鍵は暗号化列にのみ入れ、平文列には残さない', async () => {
    const res = await POST(
      req({ org_id: ORG_ID, provider: 'backlog', api_key: 'secret-key', base_url: 'https://e.backlog.jp' }),
    )
    expect(res.status).toBe(201)
    expect(insertCapture.access_token_encrypted).toBe('encrypted-key')
    expect(insertCapture.access_token).toBe('')
    expect(JSON.stringify(insertCapture)).not.toContain('secret-key')
  })

  it('取り込みは既定で無効（取り込み先を選ぶまで動かさない）', async () => {
    await POST(req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k', base_url: 'https://e.backlog.jp' }))
    expect(insertCapture.import_enabled).toBe(false)
    expect(insertCapture.auth_kind).toBe('api_key')
  })

  it('外部テナント識別子はホスト名を正規化して入れる（表記揺れで二重接続を素通りさせない）', async () => {
    await POST(req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k', base_url: 'https://Example.Backlog.jp' }))
    expect(insertCapture.external_account_key).toBe('example.backlog.jp')
  })

  it('ツール固有設定は接頭辞が付いたキーだけを保存する（他ツールの設定を混入させない）', async () => {
    await POST(
      req({
        org_id: ORG_ID,
        provider: 'backlog',
        api_key: 'k',
        base_url: 'https://e.backlog.jp',
        provider_config: {
          backlog_completion_status_id: 12,
          trello_done_list_ids: ['x'], // 他ツールの設定は捨てる
          evil: { nested: true }, // 想定外の構造も捨てる
        },
      }),
    )
    expect(insertCapture.import_config).toEqual({ backlog_completion_status_id: 12 })
  })

  it('鍵の検証にはツール固有設定も渡す（Jiraのようにメールと鍵が揃って初めて認証が成立するため）', async () => {
    const a = adapter({ id: 'jira' })
    getTaskSyncAdapter.mockReturnValue(a)
    await POST(
      req({
        org_id: ORG_ID,
        provider: 'jira',
        api_key: 'token',
        base_url: 'https://e.backlog.jp',
        provider_config: { jira_email: 'ops@example.com' },
      }),
    )
    expect(a.listContainers).toHaveBeenCalledWith(
      expect.objectContaining({ config: { jira_email: 'ops@example.com' } }),
    )
  })

  it('同じ接続先への二重接続は 409（二重取り込みになるため）', async () => {
    insertError = { code: '23505', message: 'duplicate key' }
    const res = await POST(
      req({ org_id: ORG_ID, provider: 'backlog', api_key: 'k', base_url: 'https://e.backlog.jp' }),
    )
    expect(res.status).toBe(409)
  })
})

/**
 * kintone_app_tokens(app_id→個別暗号化トークンのjsonbオブジェクト。「どのトークンがどのアプリの
 * ものか」の正本。20260723014852_kintone_apps_merge_rpc.sql参照)を接続作成時にも書き込む。
 *
 * ⚠ このトークン対応づけが成立するのは、apiKey(カンマ結合済みトークン)とkintone_app_idsが
 * 「同じ1リクエストの中で、同じ行配列から同時に組み立てられた」場合だけ(KintoneConnectForm.tsx
 * がその契約を守る)。トークン数とアプリ数が一致しない入力(この経路を新UI以外から直接叩いた場合)
 * では対応を確定できないため、接続作成自体は拒否せず、kintone_app_tokensの書き込みだけを諦める
 * (位置で推測して黙って誤対応させない。後続のアプリ追加/削除時にKTGAPで再接続を促す設計)。
 */
describe('kintone: kintone_app_tokens(トークンとアプリの対応)の作成時書き込み', () => {
  beforeEach(() => {
    getTaskSyncAdapter.mockReturnValue(
      adapter({ id: 'kintone', hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.cybozu.com'] } }),
    )
  })

  it('トークン数とアプリ数が一致するなら、appId→暗号化トークンの対応をimport_configへ書き込む', async () => {
    encryptToken.mockImplementation(async (plaintext: string) => `enc(${plaintext})`)
    const res = await POST(
      req({
        org_id: ORG_ID,
        provider: 'kintone',
        api_key: 'token-5,token-9',
        base_url: 'https://e.cybozu.com',
        provider_config: { kintone_app_ids: ['5', '9'] },
      }),
    )
    expect(res.status).toBe(201)
    expect(insertCapture.import_config).toMatchObject({
      kintone_app_ids: ['5', '9'],
      kintone_app_tokens: { '5': 'enc(token-5)', '9': 'enc(token-9)' },
    })
    // 平文トークンをそのまま(暗号化を経ずに)import_configへ残していないこと
    // (encryptTokenの戻り値をそのまま使っており、生の 'token-5'/'token-9' という値ではない)。
    const tokens = insertCapture.import_config as { kintone_app_tokens: Record<string, string> }
    expect(tokens.kintone_app_tokens['5']).not.toBe('token-5')
    expect(tokens.kintone_app_tokens['9']).not.toBe('token-9')
  })

  it('トークン数とアプリ数が一致しない場合は、対応が組めないため書き込みを諦める(接続自体は拒否しない)', async () => {
    const res = await POST(
      req({
        org_id: ORG_ID,
        provider: 'kintone',
        api_key: 'only-one-token',
        base_url: 'https://e.cybozu.com',
        provider_config: { kintone_app_ids: ['5', '9'] },
      }),
    )
    expect(res.status).toBe(201)
    expect(insertCapture.import_config).not.toHaveProperty('kintone_app_tokens')
  })
})

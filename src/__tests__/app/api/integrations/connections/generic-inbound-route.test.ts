import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/integrations/connections/generic-inbound — 汎用Webhook受信口の作成。
 *
 * この接続は**こちらから外部を叩かない**ので、接続先URLもAPIキーも預からない。渡すのは
 * 「送り先URL」と「署名用の鍵」だけ。鍵は作成時の応答でしか返らない（以後の取得経路が無い）。
 */

const requireOrgAdmin = vi.fn()
const encryptConnectorSecret = vi.fn()
const insertCapture: Record<string, unknown> = {}
let insertError: unknown = null

vi.mock('@/lib/channels/authz', () => ({ requireOrgAdmin: (...a: unknown[]) => requireOrgAdmin(...a) }))
vi.mock('@/lib/connectors/secrets', () => ({
  generateConnectorSecret: () => 'plaintext-secret',
  encryptConnectorSecret: (...a: unknown[]) => encryptConnectorSecret(...a),
}))
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

const { POST } = await import('@/app/api/integrations/connections/generic-inbound/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/integrations/connections/generic-inbound', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const k of Object.keys(insertCapture)) delete insertCapture[k]
  insertError = null
  requireOrgAdmin.mockReset().mockResolvedValue({ ok: true })
  encryptConnectorSecret.mockReset().mockResolvedValue('encrypted-secret')
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('認可', () => {
  it('owner/admin でなければ作れない（鍵を発行する操作のため）', async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
    expect((await POST(req({ org_id: ORG_ID }))).status).toBe(403)
  })
})

describe('作成', () => {
  it('送り先URLと平文の鍵を返す（鍵はこの応答でしか手に入らない）', async () => {
    const res = await POST(req({ org_id: ORG_ID }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.webhook_url).toBe('https://app.example.com/api/connectors/generic/events')
    expect(data.receive_secret).toBe('plaintext-secret')
  })

  it('鍵は暗号化して保存し、平文はDBに残さない', async () => {
    await POST(req({ org_id: ORG_ID }))
    const metadata = insertCapture.metadata as Record<string, Record<string, unknown>>
    expect(metadata.generic_inbound.receive_secret_encrypted).toBe('encrypted-secret')
    expect(JSON.stringify(insertCapture)).not.toContain('plaintext-secret')
  })

  it('外部を叩かない接続なので接続先URLもAPIキーも持たない', async () => {
    await POST(req({ org_id: ORG_ID }))
    expect(insertCapture.auth_kind).toBe('shared_secret')
    expect(insertCapture.base_url).toBeUndefined()
    expect(insertCapture.access_token).toBe('')
  })

  it('取り込みは既定で無効（取り込み先を選ぶまで受信を受け付けない）', async () => {
    await POST(req({ org_id: ORG_ID }))
    expect(insertCapture.import_enabled).toBe(false)
  })

  it('呼び名を付けると複数の送信元を並べられる', async () => {
    await POST(req({ org_id: ORG_ID, label: 'ANDPAD経由' }))
    // 一意インデックスが (provider, owner, coalesce(key,'')) なので、呼び名が識別子になる。
    expect(insertCapture.external_account_key).toBe('andpad経由')
  })

  it('呼び名なしなら org につき1つ（識別子を持たない＝従来どおり1接続）', async () => {
    await POST(req({ org_id: ORG_ID }))
    expect(insertCapture.external_account_key).toBeNull()
  })

  it('同じ呼び名の重複は 409（どちらから来た通知か分からなくなるため）', async () => {
    insertError = { code: '23505', message: 'duplicate key' }
    expect((await POST(req({ org_id: ORG_ID, label: 'ANDPAD経由' }))).status).toBe(409)
  })
})

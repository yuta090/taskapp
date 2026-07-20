import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/integrations/connections/multica — multica接続の作成。
 *
 * - owner/adminのみ(requireOrgAdmin)
 * - base_urlはSSRF検証(validateWebhookUrl)を通す
 * - send/receiveの2本の鍵を生成し暗号化して保存、平文は作成時に一度だけ返す
 *   (src/lib/sinks/store.ts createWebhookSinkと同方式)。平文フォールバックは持たない。
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

const validateWebhookUrlMock = vi.fn()
vi.mock('@/lib/sinks/ssrf', () => ({
  validateWebhookUrl: (...args: unknown[]) => validateWebhookUrlMock(...args),
}))

const generateConnectorSecretMock = vi.fn()
const encryptConnectorSecretMock = vi.fn()
vi.mock('@/lib/connectors/secrets', () => ({
  generateConnectorSecret: (...args: unknown[]) => generateConnectorSecretMock(...args),
  encryptConnectorSecret: (...args: unknown[]) => encryptConnectorSecretMock(...args),
}))

let insertPayload: Record<string, unknown> | null = null
const insertResultMock = vi.fn()
const createAdminClientMock = vi.fn(() => ({
  from: vi.fn(() => ({
    insert: vi.fn((payload: Record<string, unknown>) => {
      insertPayload = payload
      return {
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve(insertResultMock())),
        })),
      }
    }),
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { POST } = await import('@/app/api/integrations/connections/multica/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/multica', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const validBody = { org_id: ORG_ID, base_url: 'https://multica.example.com' }

beforeEach(() => {
  vi.clearAllMocks()
  insertPayload = null
  process.env.NEXT_PUBLIC_APP_URL = 'https://taskapp.example.com'
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  validateWebhookUrlMock.mockResolvedValue({ ok: true, hostname: 'multica.example.com', port: 443, resolvedIps: ['8.8.8.8'] })
  generateConnectorSecretMock
    .mockReturnValueOnce('plain-send-secret')
    .mockReturnValueOnce('plain-receive-secret')
  encryptConnectorSecretMock.mockImplementation(async (plaintext: string) => `enc(${plaintext})`)
  insertResultMock.mockReturnValue({ data: { id: CONNECTION_ID }, error: null })
})

describe('POST /api/integrations/connections/multica', () => {
  it('400 when org_id is missing/invalid', async () => {
    const response = await callPost({ ...validBody, org_id: 'not-a-uuid' })
    expect(response.status).toBe(400)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPost(validBody)
    expect(response.status).toBe(403)
  })

  it('401 when not logged in', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPost(validBody)
    expect(response.status).toBe(401)
  })

  it('400 when base_url is missing', async () => {
    const response = await callPost({ org_id: ORG_ID })
    expect(response.status).toBe(400)
  })

  it('400 when the SSRF validator rejects base_url (never reaches insert)', async () => {
    validateWebhookUrlMock.mockResolvedValue({ ok: false, reason: 'ip_denied' })
    const response = await callPost(validBody)
    expect(response.status).toBe(400)
    expect(insertPayload).toBeNull()
  })

  it('201 creates the connection and returns both secrets once (plaintext)', async () => {
    const response = await callPost(validBody)
    const data = await response.json()
    expect(response.status).toBe(201)
    expect(data.connection_id).toBe(CONNECTION_ID)
    expect(data.base_url).toBe('https://multica.example.com')
    expect(data.webhook_url).toBe('https://taskapp.example.com/api/connectors/multica/events')
    expect(data.send_secret).toBe('plain-send-secret')
    expect(data.receive_secret).toBe('plain-receive-secret')
  })

  it('persists only encrypted secrets in metadata (no plaintext saved)', async () => {
    await callPost(validBody)
    expect(insertPayload).not.toBeNull()
    const metadata = insertPayload!.metadata as { multica: Record<string, unknown> }
    expect(metadata.multica.send_secret_encrypted).toBe('enc(plain-send-secret)')
    expect(metadata.multica.receive_secret_encrypted).toBe('enc(plain-receive-secret)')
    expect(metadata.multica.send_secret).toBeUndefined()
    expect(metadata.multica.receive_secret).toBeUndefined()
    expect(insertPayload!.provider).toBe('multica')
    expect(insertPayload!.owner_type).toBe('org')
    expect(insertPayload!.org_id).toBe(ORG_ID)
    expect(insertPayload!.status).toBe('active')
  })

  it('500 when the insert fails (generic error — no internal message leaked)', async () => {
    insertResultMock.mockReturnValue({ data: null, error: { message: 'db error' } })
    const response = await callPost(validBody)
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data.error).not.toContain('db error')
  })

  it('409 (not 500) on a second multica connection — unique violation mapped cleanly, no constraint name leak', async () => {
    insertResultMock.mockReturnValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "integration_connections_provider_owner_type_owner_id_key"',
      },
    })
    const response = await callPost(validBody)
    const data = await response.json()
    expect(response.status).toBe(409)
    expect(data.error).not.toContain('constraint')
    expect(data.error).not.toContain('integration_connections')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/ai-config — org-level AI provider config (BYO API key, encrypted at rest).
 *
 * Security-critical: only org owners may write/delete the config, and no
 * endpoint may return the decrypted API key in full (only a short prefix).
 */

const ORG_ID = 'org-1'
const mockUser = { id: 'user-1' }

let authResponse: { data: { user: typeof mockUser | null }; error: { message: string } | null }
let membershipResponse: { data: { role: string } | null }
let configSelectResponse: {
  data: { id: string; org_id: string; provider: string; model: string; enabled: boolean; api_key_encrypted: string; created_at: string; updated_at: string } | null
  error: { code: string; message: string } | null
}
let decryptRpcResponse: { data: string | null; error: { message: string } | null }
let encryptRpcResponse: { data: string | null; error: { message: string } | null }
let upsertResponse: { error: { message: string } | null }
let adminDeleteResponse: { error: { message: string } | null }

const sessionSelectEqSingleMock = vi.fn(() => Promise.resolve(configSelectResponse))
const sessionMembershipSingleMock = vi.fn(() => Promise.resolve(membershipResponse))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'org_ai_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: sessionSelectEqSingleMock,
              })),
            })),
          }
        }
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: sessionMembershipSingleMock,
                })),
              })),
            })),
          }
        }
        return {}
      }),
    })
  ),
}))

const adminDeleteEqMock = vi.fn(() => Promise.resolve(adminDeleteResponse))
const adminDeleteMock = vi.fn(() => ({ eq: adminDeleteEqMock }))
const adminUpsertMock = vi.fn(() => Promise.resolve(upsertResponse))
const adminRpcMock = vi.fn((fn: string) => {
  if (fn === 'decrypt_slack_token') return Promise.resolve(decryptRpcResponse)
  if (fn === 'encrypt_slack_token') return Promise.resolve(encryptRpcResponse)
  return Promise.resolve({ data: null, error: null })
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: adminRpcMock,
    from: vi.fn((table: string) => {
      if (table === 'org_ai_config') {
        return {
          upsert: adminUpsertMock,
          delete: adminDeleteMock,
        }
      }
      return {}
    }),
  })),
}))

vi.mock('@/lib/slack/config', () => ({
  SLACK_CONFIG: { clientSecret: 'test-slack-secret' },
}))

const { GET, POST, DELETE } = await import('@/app/api/ai-config/route')

function callGet(orgId?: string) {
  const url = new URL('/api/ai-config', 'http://localhost:3000')
  if (orgId) url.searchParams.set('orgId', orgId)
  return GET(new NextRequest(url, { method: 'GET' }))
}

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/ai-config', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function callDelete(orgId?: string) {
  const url = new URL('/api/ai-config', 'http://localhost:3000')
  if (orgId) url.searchParams.set('orgId', orgId)
  return DELETE(new NextRequest(url, { method: 'DELETE' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'

  authResponse = { data: { user: mockUser }, error: null }
  membershipResponse = { data: { role: 'owner' } }
  configSelectResponse = {
    data: {
      id: 'config-1',
      org_id: ORG_ID,
      provider: 'openai',
      model: 'gpt-4o-mini',
      enabled: true,
      api_key_encrypted: 'enc-blob',
      created_at: '2026-01-01T00:00:00',
      updated_at: '2026-01-01T00:00:00',
    },
    error: null,
  }
  decryptRpcResponse = { data: 'sk-superSecretValue1234567890', error: null }
  encryptRpcResponse = { data: 'enc-blob-new', error: null }
  upsertResponse = { error: null }
  adminDeleteResponse = { error: null }
})

describe('GET /api/ai-config', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callGet(ORG_ID)

    expect(response.status).toBe(401)
  })

  it('returns 400 when orgId is missing', async () => {
    const response = await callGet()

    expect(response.status).toBe(400)
  })

  it('returns config: null when no config exists for the org', async () => {
    configSelectResponse = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const response = await callGet(ORG_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.config).toBeNull()
  })

  it('returns 500 on a real database error (not the "no rows" code)', async () => {
    configSelectResponse = { data: null, error: { code: 'XX000', message: 'connection reset' } }

    const response = await callGet(ORG_ID)

    expect(response.status).toBe(500)
  })

  it('returns only a short key prefix, never the full decrypted API key', async () => {
    const response = await callGet(ORG_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.config.keyPrefix).toBe('sk-super...')
    expect(data.config.keyPrefix).not.toContain('SecretValue1234567890')
    expect(JSON.stringify(data)).not.toContain('sk-superSecretValue1234567890')
  })

  it('never includes the raw encrypted blob or ciphertext field in the response', async () => {
    const response = await callGet(ORG_ID)
    const data = await response.json()

    expect(data.config.api_key_encrypted).toBeUndefined()
    expect(JSON.stringify(data)).not.toContain('enc-blob')
  })

  it('falls back to a masked prefix when decryption fails, without erroring the request', async () => {
    adminRpcMock.mockImplementationOnce(() => Promise.reject(new Error('decrypt failed')))

    const response = await callGet(ORG_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.config.keyPrefix).toBe('****...')
  })

  it('returns 403 when the caller is not an org owner (defense-in-depth like POST/DELETE)', async () => {
    membershipResponse = { data: { role: 'member' } }

    const response = await callGet(ORG_ID)

    expect(response.status).toBe(403)
  })

  it('returns 403 when the caller has no membership in the org at all', async () => {
    membershipResponse = { data: null }

    const response = await callGet(ORG_ID)

    expect(response.status).toBe(403)
  })
})

describe('POST /api/ai-config', () => {
  const basePostBody = { orgId: ORG_ID, provider: 'openai', apiKey: 'sk-abc123456789' }

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(401)
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ orgId: ORG_ID, provider: 'openai' })

    expect(response.status).toBe(400)
  })

  it('returns 400 for an unsupported provider', async () => {
    const response = await callPost({ ...basePostBody, provider: 'cohere' })

    expect(response.status).toBe(400)
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the OpenAI key does not start with sk-', async () => {
    const response = await callPost({ ...basePostBody, apiKey: 'not-a-key' })

    expect(response.status).toBe(400)
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the Anthropic key does not start with sk-ant-', async () => {
    const response = await callPost({ orgId: ORG_ID, provider: 'anthropic', apiKey: 'sk-wrong-prefix' })

    expect(response.status).toBe(400)
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not an org owner', async () => {
    membershipResponse = { data: { role: 'member' } }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only org owners can configure AI settings')
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller has no membership in the org at all', async () => {
    membershipResponse = { data: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('encrypts the key before persisting and never stores/returns it in plaintext', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(adminUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ api_key_encrypted: 'enc-blob-new', org_id: ORG_ID }),
      expect.anything()
    )
    expect(JSON.stringify(data)).not.toContain(basePostBody.apiKey)
    expect(data.config.keyPrefix).toBe('sk-abc12...')
  })

  it('returns 500 without leaking crypto details when encryption fails', async () => {
    encryptRpcResponse = { data: null, error: { message: 'kms unavailable' } }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to encrypt API key')
    expect(adminUpsertMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the upsert fails', async () => {
    upsertResponse = { error: { message: 'constraint violation' } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(500)
  })
})

describe('DELETE /api/ai-config', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callDelete(ORG_ID)

    expect(response.status).toBe(401)
    expect(adminDeleteMock).not.toHaveBeenCalled()
  })

  it('returns 400 when orgId is missing', async () => {
    const response = await callDelete()

    expect(response.status).toBe(400)
  })

  it('returns 403 when the caller is not an org owner', async () => {
    membershipResponse = { data: { role: 'member' } }

    const response = await callDelete(ORG_ID)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only org owners can delete AI config')
    expect(adminDeleteMock).not.toHaveBeenCalled()
  })

  it('deletes the config when the caller is an org owner', async () => {
    const response = await callDelete(ORG_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(adminDeleteEqMock).toHaveBeenCalledWith('org_id', ORG_ID)
  })

  it('returns 500 when the delete fails', async () => {
    adminDeleteResponse = { error: { message: 'fk violation' } }

    const response = await callDelete(ORG_ID)

    expect(response.status).toBe(500)
  })
})

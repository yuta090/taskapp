import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/integrations/connections/multica/[id]/rotate?direction=send|receive
 *
 * - owner/adminのみ(接続のorg_idから解決)
 * - direction=send|receive以外は400
 * - 対象方向の鍵だけを再生成・暗号化保存し、他方向・base_urlは保持する
 * - 平文は一度だけ返す
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

const generateConnectorSecretMock = vi.fn()
const encryptConnectorSecretMock = vi.fn()
vi.mock('@/lib/connectors/secrets', () => ({
  generateConnectorSecret: (...args: unknown[]) => generateConnectorSecretMock(...args),
  encryptConnectorSecret: (...args: unknown[]) => encryptConnectorSecretMock(...args),
}))

const findResultMock = vi.fn()
let updatePayload: Record<string, unknown> | null = null
const updateResultMock = vi.fn()

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(findResultMock())),
  })
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown) => resolve(updateResultMock()),
  })
  return chain
}

const createAdminClientMock = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload
      return makeUpdateChain()
    }),
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { POST } = await import('@/app/api/integrations/connections/multica/[id]/rotate/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'

function callPost(id: string, direction: string | null) {
  const url = new URL(`http://localhost:3000/api/integrations/connections/multica/${id}/rotate`)
  if (direction !== null) url.searchParams.set('direction', direction)
  const request = new NextRequest(url, { method: 'POST' })
  return POST(request, { params: Promise.resolve({ id }) })
}

const EXISTING_METADATA = {
  multica: {
    base_url: 'https://multica.example.com',
    send_secret_encrypted: 'enc(old-send)',
    receive_secret_encrypted: 'enc(old-receive)',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  updatePayload = null
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  findResultMock.mockReturnValue({
    data: { id: CONNECTION_ID, org_id: ORG_ID, provider: 'multica', metadata: EXISTING_METADATA },
    error: null,
  })
  generateConnectorSecretMock.mockReturnValue('new-plain-secret')
  encryptConnectorSecretMock.mockImplementation(async (plaintext: string) => `enc(${plaintext})`)
  updateResultMock.mockReturnValue({ data: null, error: null })
})

describe('POST /api/integrations/connections/multica/[id]/rotate', () => {
  it('400 for an invalid connection id', async () => {
    const response = await callPost('not-a-uuid', 'send')
    expect(response.status).toBe(400)
  })

  it("400 when direction is missing or not 'send'/'receive'", async () => {
    const response = await callPost(CONNECTION_ID, 'sideways')
    expect(response.status).toBe(400)
  })

  it('404 when the connection does not exist (or is not a multica connection)', async () => {
    findResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPost(CONNECTION_ID, 'send')
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPost(CONNECTION_ID, 'send')
    expect(response.status).toBe(403)
  })

  it('200 rotates only the send secret, preserving receive_secret_encrypted and base_url', async () => {
    const response = await callPost(CONNECTION_ID, 'send')
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.direction).toBe('send')
    expect(data.secret).toBe('new-plain-secret')

    const metadata = updatePayload!.metadata as { multica: Record<string, unknown> }
    expect(metadata.multica.send_secret_encrypted).toBe('enc(new-plain-secret)')
    expect(metadata.multica.receive_secret_encrypted).toBe('enc(old-receive)')
    expect(metadata.multica.base_url).toBe('https://multica.example.com')
  })

  it('200 rotates only the receive secret, preserving send_secret_encrypted and base_url', async () => {
    const response = await callPost(CONNECTION_ID, 'receive')
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.direction).toBe('receive')
    expect(data.secret).toBe('new-plain-secret')

    const metadata = updatePayload!.metadata as { multica: Record<string, unknown> }
    expect(metadata.multica.receive_secret_encrypted).toBe('enc(new-plain-secret)')
    expect(metadata.multica.send_secret_encrypted).toBe('enc(old-send)')
    expect(metadata.multica.base_url).toBe('https://multica.example.com')
  })
})

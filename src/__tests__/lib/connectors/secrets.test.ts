import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/connectors/secrets.ts — コネクタ双方向シークレット(send/receive)の暗号化ヘルパー。
 * src/lib/sinks/store.ts の encryptSecret/decryptSecret と同方式(encrypt_system_secret/
 * decrypt_system_secret RPC + SYSTEM_ENCRYPTION_KEY)。平文フォールバックは持たない。
 */

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}))

const { encryptConnectorSecret, decryptConnectorSecret, generateConnectorSecret } = await import(
  '@/lib/connectors/secrets'
)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-key'
})

describe('generateConnectorSecret', () => {
  it('64桁hex(32byteランダム値)を返す', () => {
    const s = generateConnectorSecret()
    expect(s).toMatch(/^[0-9a-f]{64}$/)
  })

  it('呼ぶたびに異なる値を返す', () => {
    expect(generateConnectorSecret()).not.toBe(generateConnectorSecret())
  })
})

describe('encryptConnectorSecret', () => {
  it('encrypt_system_secret RPCを正しい引数(plaintext, secret=キー)で呼び、結果をそのまま返す', async () => {
    rpcMock.mockResolvedValue({ data: 'enc_abc', error: null })
    const result = await encryptConnectorSecret('plain-secret')
    expect(result).toBe('enc_abc')
    expect(rpcMock).toHaveBeenCalledWith('encrypt_system_secret', {
      plaintext: 'plain-secret',
      secret: 'test-key',
    })
  })

  it('RPCがエラーを返したら例外を投げる', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(encryptConnectorSecret('x')).rejects.toThrow('encrypt_system_secret failed')
  })

  it('SYSTEM_ENCRYPTION_KEY未設定なら例外を投げる', async () => {
    delete process.env.SYSTEM_ENCRYPTION_KEY
    await expect(encryptConnectorSecret('x')).rejects.toThrow('SYSTEM_ENCRYPTION_KEY is not configured')
  })
})

describe('decryptConnectorSecret', () => {
  it('decrypt_system_secret RPCを正しい引数で呼び、復号済み平文を返す', async () => {
    rpcMock.mockResolvedValue({ data: 'plain-secret', error: null })
    const result = await decryptConnectorSecret('enc_abc')
    expect(result).toBe('plain-secret')
    expect(rpcMock).toHaveBeenCalledWith('decrypt_system_secret', {
      encrypted: 'enc_abc',
      secret: 'test-key',
    })
  })

  it('RPCがエラーを返したらnullを返す(投げない)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'bad' } })
    const result = await decryptConnectorSecret('bad-cipher')
    expect(result).toBeNull()
  })

  it('dataが無い(nullish)場合もnullを返す', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    const result = await decryptConnectorSecret('x')
    expect(result).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * src/lib/integrations/token-crypto.ts — integration_connections のOAuthトークン暗号化。
 *
 * 背景: access_token/refresh_token は 20260214_000_integration_connections.sql 以来 **平文** の
 * text 列だった。同リポジトリの他の資格情報 (channel_accounts.credentials_encrypted /
 * system_integration_configs.credentials_encrypted / integration_sinks.secret_encrypted) は
 * pgcrypto(encrypt_system_secret) で暗号化しており、ここだけ方針が不揃いだった。
 *
 * Google Tasks 連携(auth/tasks = 個人の全ToDoの読み書き)を一般スタッフ全員に接続させる前提が
 * 出てきたため、平文のまま権限と接続者数を増やすのは許容できない。既存3テーブルと同じ
 * encrypt_system_secret / decrypt_system_secret (pgp_sym_encrypt + base64、鍵はアプリの
 * SYSTEM_ENCRYPTION_KEY を引数で渡す) に揃える。
 */

const rpcMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock })),
}))

const { encryptToken, decryptToken } = await import('@/lib/integrations/token-crypto')

const ORIGINAL_KEY = process.env.SYSTEM_ENCRYPTION_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SYSTEM_ENCRYPTION_KEY
  else process.env.SYSTEM_ENCRYPTION_KEY = ORIGINAL_KEY
})

describe('encryptToken', () => {
  it('encrypt_system_secret に平文とSYSTEM_ENCRYPTION_KEYを渡し、暗号文を返す', async () => {
    rpcMock.mockResolvedValue({ data: 'ENCRYPTED_BLOB', error: null })

    const result = await encryptToken('ya29.plaintext-access-token')

    expect(result).toBe('ENCRYPTED_BLOB')
    expect(rpcMock).toHaveBeenCalledWith('encrypt_system_secret', {
      plaintext: 'ya29.plaintext-access-token',
      secret: 'test-encryption-key',
    })
  })

  it('SYSTEM_ENCRYPTION_KEY が未設定なら throw する(平文で保存させない)', async () => {
    delete process.env.SYSTEM_ENCRYPTION_KEY
    await expect(encryptToken('x')).rejects.toThrow('SYSTEM_ENCRYPTION_KEY')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('RPCがエラーを返したら throw する(暗号化できないまま続行しない)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(encryptToken('x')).rejects.toThrow('encrypt_system_secret')
  })
})

describe('decryptToken', () => {
  it('decrypt_system_secret に暗号文とSYSTEM_ENCRYPTION_KEYを渡し、平文を返す', async () => {
    rpcMock.mockResolvedValue({ data: 'ya29.plaintext-access-token', error: null })

    const result = await decryptToken('ENCRYPTED_BLOB')

    expect(result).toBe('ya29.plaintext-access-token')
    expect(rpcMock).toHaveBeenCalledWith('decrypt_system_secret', {
      encrypted: 'ENCRYPTED_BLOB',
      secret: 'test-encryption-key',
    })
  })

  it('SYSTEM_ENCRYPTION_KEY が未設定なら throw する', async () => {
    delete process.env.SYSTEM_ENCRYPTION_KEY
    await expect(decryptToken('x')).rejects.toThrow('SYSTEM_ENCRYPTION_KEY')
  })

  // 一時的なRPC/DB障害(errorセット)と、暗号文が復号結果を持たない恒久破損(errorなし・dataなし)を
  // 区別する。前者を null にすると「トークン無し」と誤認され、平文フォールバック撤去後は正当な接続が
  // 一時障害で expired 化されたり null が外部APIへ渡ったりする。よって error は throw、!data は null。
  it('【本丸】RPCが error を返したら throw する(一時障害の可能性。null=トークン無しと誤認させない)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(decryptToken('ENCRYPTED_BLOB')).rejects.toThrow()
  })

  it('例外メッセージに暗号文・トークン・鍵を含めない', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    let caught: unknown
    try {
      await decryptToken('SUPER_SECRET_BLOB')
    } catch (e) {
      caught = e
    }
    const msg = (caught as Error)?.message ?? ''
    expect(msg).not.toContain('SUPER_SECRET_BLOB')
    expect(msg).not.toContain('test-encryption-key')
  })

  it('error は無いが data も無いなら null(暗号文が復号結果を持たない=恒久破損。再接続を促す)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    expect(await decryptToken('ENCRYPTED_BLOB')).toBeNull()
  })

  it('null/空文字を渡したら null を返す(RPCを呼ばない)', async () => {
    expect(await decryptToken(null)).toBeNull()
    expect(await decryptToken('')).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

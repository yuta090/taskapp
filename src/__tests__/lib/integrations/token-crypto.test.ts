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

  it('復号に失敗したら null を返す(鍵ローテ・不正blob。呼び出し側が再接続へ倒せるようにする)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'wrong key' } })
    expect(await decryptToken('ENCRYPTED_BLOB')).toBeNull()
  })

  it('null/空文字を渡したら null を返す(RPCを呼ばない)', async () => {
    expect(await decryptToken(null)).toBeNull()
    expect(await decryptToken('')).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

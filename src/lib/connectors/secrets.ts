import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * コネクタ(multica等)の双方向シークレット(send/receive)を暗号化して扱う共用ヘルパー。
 *
 * src/lib/sinks/store.ts の encryptSecret/decryptSecret と同方式
 * (encrypt_system_secret / decrypt_system_secret RPC + SYSTEM_ENCRYPTION_KEY)を
 * コネクタ層向けに切り出したもの。読み手(multica/client.ts の requireMulticaMetadata、
 * inbound.ts の receiveSecretOf)はここを経由して復号する。
 *
 * 平文フォールバックは持たない: 本ブランチは未マージ(既存データ無し)のクリーンカットのため、
 * *_secret_encrypted 以外の平文キー(send_secret/receive_secret)を読む経路は作らない。
 */

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

function getEncryptionKey(): string {
  const key = process.env.SYSTEM_ENCRYPTION_KEY
  if (!key) throw new Error('SYSTEM_ENCRYPTION_KEY is not configured')
  return key
}

/** 32byte(256bit)のランダム値をhex表記(64桁)で返す。send/receive鍵の生成用。 */
export function generateConnectorSecret(): string {
  return randomBytes(32).toString('hex')
}

export async function encryptConnectorSecret(plaintext: string): Promise<string> {
  const { data, error } = await admin().rpc('encrypt_system_secret', {
    plaintext,
    secret: getEncryptionKey(),
  })
  if (error || !data) {
    throw new Error(`encrypt_system_secret failed: ${error?.message ?? 'no data'}`)
  }
  return data as string
}

export async function decryptConnectorSecret(encrypted: string): Promise<string | null> {
  const { data, error } = await admin().rpc('decrypt_system_secret', {
    encrypted,
    secret: getEncryptionKey(),
  })
  if (error || !data) return null
  return data as string
}

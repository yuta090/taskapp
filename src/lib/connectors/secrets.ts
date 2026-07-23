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

/**
 * decryptConnectorSecret の詳細版。復号RPC/vault の**一時障害(error)**と**恒久破損(結果が空)**を
 * 区別して返す。送信経路(multica/client.ts の requireMulticaMetadata)専用。
 *
 * なぜ区別が要るか(Fable 裁定 2026-07-23): 一律 null(=恒久失敗 permanent_fail=dead)に畳むと、
 * 「主DBは健全だが復号RPC/vault だけ一時的に落ちる」障害で、配達を試みる前の失敗が attempt 予算を
 * 食い、最終的に job が dead(永久喪失)になる。一時障害は attempt を消費しない defer に回したい。
 * decrypt_system_secret / decryptToken の「error→一時障害 / 結果空→恒久破損」の区別に揃える。
 *
 * 既存の decryptConnectorSecret(null 集約)は inbound の署名検証(inbound.ts/genericInbound.ts)が
 * そのまま使う(そこは「復号できない=検証不成立で拒否」で正しく、defer の概念が無い)。挙動は不変。
 */
export type ConnectorSecretResolution =
  | { status: 'ok'; secret: string }
  /** 復号RPC/DB の一時障害。呼び出し側は attempt を消費しない defer に回してよい。 */
  | { status: 'transient_error' }
  /** error は無いが復号結果が空=恒久破損(鍵不一致/blob破損)。再試行では直らない。 */
  | { status: 'corrupt' }

export async function resolveConnectorSecret(encrypted: string): Promise<ConnectorSecretResolution> {
  const { data, error } = await admin().rpc('decrypt_system_secret', {
    encrypted,
    secret: getEncryptionKey(),
  })
  if (error) return { status: 'transient_error' }
  if (!data) return { status: 'corrupt' }
  return { status: 'ok', secret: data as string }
}

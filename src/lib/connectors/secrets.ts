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
 *
 * 【破損 blob の分類は transient のままにする(Fable 裁定 2026-07-23・変更しない)】
 *   pgcrypto(decrypt_system_secret)は**鍵不一致・blob 破損でも RPC を error で返す**。よって現実の破損は
 *   ほぼ全て下の `if (error)` に落ち、`transient_error`(=呼び出し側で defer)に分類される。これは
 *   token-crypto.decryptToken で既に是認した「破損も一時障害＝安全側」設計と同一で、破損 blob は defer で
 *   寝ても connector_jobs 側の 20回停止 / 72h キャップ(infraTransientOutcome)で temporary_fail へ降格し、
 *   最終的に dead へ**収束する**(無限には残らない)。
 *   下の `if (!data)`(error 無し・結果が空)= `corrupt` 分岐は「error を返さずに空文字を返す」pgcrypto の
 *   実挙動ではほぼ発火しない。ここを「即 permanent(dead)にしたい」と将来誤修正しないこと——それをやると
 *   復号 RPC/vault の一時瞬断で破損と断定して job を永久喪失させる退行になる(安全側を崩す)。
 */
export type ConnectorSecretResolution =
  | { status: 'ok'; secret: string }
  /** 復号RPC/DB の一時障害。呼び出し側は attempt を消費しない defer に回してよい(破損 blob もここに来る)。 */
  | { status: 'transient_error' }
  /** error は無いが復号結果が空=恒久破損(鍵不一致/blob破損)。pgcrypto の実挙動ではほぼ発火しない(上記コメント参照)。 */
  | { status: 'corrupt' }

export async function resolveConnectorSecret(encrypted: string): Promise<ConnectorSecretResolution> {
  const { data, error } = await admin().rpc('decrypt_system_secret', {
    encrypted,
    secret: getEncryptionKey(),
  })
  // error → transient(defer)。鍵不一致/blob 破損も pgcrypto はここ(error)に来るため defer で 72h 収束する。
  if (error) return { status: 'transient_error' }
  // 下は「error 無し・結果空」= corrupt。pgcrypto ではほぼ来ない分岐(即 permanent 化に変えないこと)。
  if (!data) return { status: 'corrupt' }
  return { status: 'ok', secret: data as string }
}

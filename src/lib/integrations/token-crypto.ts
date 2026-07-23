import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * integration_connections のOAuthトークン暗号化。
 *
 * 方式は同リポジトリの他の資格情報と同一に揃える:
 *   - channel_accounts.credentials_encrypted
 *   - system_integration_configs.credentials_encrypted
 *   - integration_sinks.secret_encrypted
 * いずれも encrypt_system_secret / decrypt_system_secret
 * (= encode(pgp_sym_encrypt(...), 'base64') / pgp_sym_decrypt(decode(..., 'base64'), ...))
 * を使い、鍵はDBに置かずアプリの SYSTEM_ENCRYPTION_KEY を引数で渡す。
 *
 * 暗号化(書き込み)は失敗したら必ず throw する。「暗号化できなかったので平文で保存」に
 * 倒れると、この変更の目的そのものが無効になるため。
 * 復号(読み取り)は一時障害と恒久破損を区別する: RPC が error を返したら **throw**(一時障害。
 * 呼び出し側が transient として再試行できる)、error は無いが復号結果が空なら **null**(恒久破損。
 * 呼び出し側が「再接続が必要」へ倒せる)。両者を一律 null にすると、一時的なDB/RPC障害が
 * 「トークン無し」に化けて正当な接続を失効させたり配達を永久に失ったりする(詳細は decryptToken)。
 */

let _supabaseAdmin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * SYSTEM_ENCRYPTION_KEY を読む。encryptToken/decryptToken の内部だけでなく、DB側で
 * decrypt_system_secret/encrypt_system_secret を直接呼ぶRPC（例: rpc_kintone_apps_add/remove。
 * 複数アプリのトークンを1トランザクションで束ね直す都合上、暗号鍵をRPC引数として渡す必要がある）
 * にも同じ鍵を渡す必要があるため、呼び出し元から読めるようここだけexportする。
 * 鍵そのものはログ・レスポンスに一切出さないこと。
 */
export function getEncryptionKey(): string {
  const key = process.env.SYSTEM_ENCRYPTION_KEY
  if (!key) throw new Error('SYSTEM_ENCRYPTION_KEY is not configured')
  return key
}

/** 平文トークンを暗号化する。失敗時は throw(平文保存へフォールバックしない)。 */
export async function encryptToken(plaintext: string): Promise<string> {
  const secret = getEncryptionKey()
  const { data, error } = await admin().rpc('encrypt_system_secret', { plaintext, secret })
  if (error || !data) {
    throw new Error(`encrypt_system_secret failed: ${error?.message ?? 'no data'}`)
  }
  return data as string
}

/**
 * 暗号化トークンを復号する。
 *
 * 【一時障害と恒久破損を区別する — 重要】平文フォールバックを撤去した contract フェーズでは、
 * この戻り値がそのまま「トークンの有無」の判断に使われる。両者を同一視すると、一時的な
 * RPC/DB障害で正当な接続が expired 化されたり、null が外部APIへ渡ったりする。よって:
 *   - encrypted が falsy(null/空) → null(トークンが無い、は正常な状態)。RPCも呼ばない。
 *   - RPC が error を返した → **throw**(一時的なインフラ障害の可能性。呼び出し側が
 *     「トークン無し」ではなく「一時障害」として扱えるように)。※pgcrypto は鍵不一致/破損blobも
 *     error として返すため、鍵ローテ中もここに入る＝一時障害扱いになる(安全側: 稼働中の接続を
 *     自動失効させない。鍵ローテは再暗号化マイグレーションで解消する運用前提)。
 *   - error は無いが data も無い → null(暗号文が復号結果を持たない=恒久破損。再接続を促す)。
 * 例外メッセージにトークン・暗号文・鍵を一切含めないこと。
 */
export async function decryptToken(encrypted: string | null | undefined): Promise<string | null> {
  if (!encrypted) return null
  const secret = getEncryptionKey()
  const { data, error } = await admin().rpc('decrypt_system_secret', { encrypted, secret })
  if (error) throw new Error('decrypt_system_secret failed')
  if (!data) return null
  return data as string
}

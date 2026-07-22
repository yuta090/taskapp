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
 * 復号(読み取り)は失敗したら null を返す。鍵ローテや不正blobで例外を投げると
 * 呼び出し側(sink配達のcron等)が恒久失敗するため、呼び出し側が
 * 「再接続が必要」へ倒せるようにする。
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

/** 暗号化トークンを復号する。復号不能(鍵ローテ・不正blob)なら null。 */
export async function decryptToken(encrypted: string | null | undefined): Promise<string | null> {
  if (!encrypted) return null
  const secret = getEncryptionKey()
  const { data, error } = await admin().rpc('decrypt_system_secret', { encrypted, secret })
  if (error || !data) return null
  return data as string
}

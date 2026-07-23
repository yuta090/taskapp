/**
 * platform 共通 Google Chat アカウント（channel_accounts）の seed（Google Chat PR-a）。
 *
 * 何をするか:
 *   owner_type='platform'・channel='google_chat'・org_id=NULL の共通アカウント行を1つ作る。
 *   これは全 org が相乗りする「共通（platform）」の Google Chat 接続の資格情報スロット。
 *
 * 冪等: 既に platform × google_chat の行があれば何もしない（複数生成しない）。
 *
 * ★秘匿鍵は絶対に DB に入れない（Fable 裁定）。Google のサービスアカウント鍵（SA key）は
 *   ランタイムが env（GOOGLE_CHAT_SA_KEY 等）から読む。ここで credentials_encrypted に入れるのは
 *   秘匿でない最小メタ（{"note":"SA key is provided via env, not stored in DB"}）を
 *   SYSTEM_ENCRYPTION_KEY で暗号化したものだけ。credentials_encrypted は NOT NULL のため空にできず、
 *   かつ「鍵はここに無い」ことを明示するためにこのメタを入れる。
 *
 * 実行方法（運用手動・CIでは自動実行しない）:
 *   1) .env.local に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SYSTEM_ENCRYPTION_KEY
 *   2) node scripts/seed-platform-google-chat-account.mjs
 *   （本番は対象環境の env を指すこと。マイグレーション適用後に実行する）
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_KEY = process.env.SYSTEM_ENCRYPTION_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(1)
}
if (!ENCRYPTION_KEY) {
  console.error('Error: SYSTEM_ENCRYPTION_KEY が未設定です（credentials 暗号化に必要）')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 表示名は固定（共通アカウントは白ラベルではない）。UIコピー規約に合わせ「共通LINE」相当の
// 共通接続だと分かる名称にする。Google Chat 版なので下記固定文言。
const DISPLAY_NAME = 'agentpm秘書（共通）'

// 秘匿でない最小メタ。SA key は絶対に入れない。
const NON_SECRET_CREDENTIALS = JSON.stringify({
  note: 'SA key is provided via env (not stored in DB)',
})

async function main() {
  // 冪等チェック: platform × google_chat が既にあれば終了。
  const { data: existing, error: selErr } = await supabase
    .from('channel_accounts')
    .select('id, display_name, status')
    .eq('owner_type', 'platform')
    .eq('channel', 'google_chat')
    .maybeSingle()

  if (selErr) {
    console.error('  lookup error:', selErr.message)
    process.exit(1)
  }
  if (existing) {
    console.log(`既に存在: platform google_chat account ${existing.id}（${existing.display_name} / ${existing.status}）。何もしません。`)
    return
  }

  // 非秘匿メタを SYSTEM_ENCRYPTION_KEY で暗号化（store の encrypt_system_secret 経路と同じ）。
  const { data: encrypted, error: encErr } = await supabase.rpc('encrypt_system_secret', {
    plaintext: NON_SECRET_CREDENTIALS,
    secret: ENCRYPTION_KEY,
  })
  if (encErr || !encrypted) {
    console.error('  encrypt_system_secret error:', encErr?.message ?? 'no output')
    process.exit(1)
  }

  const { data: inserted, error: insErr } = await supabase
    .from('channel_accounts')
    .insert({
      owner_type: 'platform',
      channel: 'google_chat',
      org_id: null,
      display_name: DISPLAY_NAME,
      credentials_encrypted: encrypted,
      status: 'active',
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    console.error('  insert error:', insErr?.message ?? 'no row')
    process.exit(1)
  }

  console.log(`作成しました: platform google_chat account ${inserted.id}（${DISPLAY_NAME}）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

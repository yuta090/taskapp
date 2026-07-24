/**
 * platform 共通 Microsoft Teams アカウント（channel_accounts）の seed（Teams inbound PR-1）。
 *
 * 何をするか:
 *   owner_type='platform'・channel='teams'・org_id=NULL の共通アカウント行を1つ作る。
 *   これは全 org が相乗りする「共通（platform）」の Teams Bot Framework 接続の資格情報スロット。
 *
 * 冪等: 既に platform × teams の行があれば何もしない（複数生成しない）。
 *
 * ★秘匿鍵は絶対に DB に入れない（Fable 裁定・google-chat と同じ思想）。Bot Framework の
 *   App ID / App Password は env（TEAMS_BOT_APP_ID / TEAMS_BOT_APP_PASSWORD）からランタイムが
 *   読む。ここで credentials_encrypted に入れるのは秘匿でない最小メタ
 *   （{"note":"App ID/Password are provided via env, not stored in DB"}）を
 *   SYSTEM_ENCRYPTION_KEY で暗号化したものだけ。credentials_encrypted は NOT NULL のため
 *   空にできず、かつ「鍵はここに無い」ことを明示するためにこのメタを入れる。
 *
 * 実行方法（運用手動・CIでは自動実行しない）:
 *   1) .env.local に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SYSTEM_ENCRYPTION_KEY
 *   2) supabase/migrations/20260724091826_teams_inbound_bootstrap.sql 適用後に実行すること
 *      （必須ではないが順序を揃える）
 *   3) node scripts/seed-platform-teams-account.mjs
 *   （本番は対象環境の env を指すこと）
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

// 表示名は固定（共通アカウントは白ラベルではない）。
const DISPLAY_NAME = 'agentpm秘書（共通）'

// 秘匿でない最小メタ。App ID/Password は絶対に入れない。
const NON_SECRET_CREDENTIALS = JSON.stringify({
  note: 'App ID/Password are provided via env (not stored in DB)',
})

async function main() {
  // 冪等チェック: platform × teams が既にあれば終了。
  const { data: existing, error: selErr } = await supabase
    .from('channel_accounts')
    .select('id, display_name, status')
    .eq('owner_type', 'platform')
    .eq('channel', 'teams')
    .maybeSingle()

  if (selErr) {
    console.error('  lookup error:', selErr.message)
    process.exit(1)
  }
  if (existing) {
    console.log(`既に存在: platform teams account ${existing.id}（${existing.display_name} / ${existing.status}）。何もしません。`)
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
      channel: 'teams',
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

  console.log(`作成しました: platform teams account ${inserted.id}（${DISPLAY_NAME}）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

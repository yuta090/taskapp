#!/usr/bin/env node
/**
 * Slack アプリの設定（表示名・説明・スラッシュコマンド・URL・権限）を manifest で作成/書き換える。
 *
 * 前提: .env.local に App Configuration Token を置く（12時間で失効・適用後は消してよい）
 *   SLACK_CONFIG_ACCESS_TOKEN=xoxe.xoxp-...   （api.slack.com/apps → Your App Configuration Tokens → Generate）
 *
 * 使い方:
 *   # 旧 AgentPM 連携アプリ（既定: docs/slack-app-manifest.json / A0AF808AZ41）
 *   node scripts/slack-manifest-apply.mjs --export          # 今 Slack に入っている設定を表示
 *   node scripts/slack-manifest-apply.mjs --check           # 送る前の検証だけ
 *   node scripts/slack-manifest-apply.mjs                   # 検証して書き換え
 *
 *   # AI秘書アプリ（自社Slack）: 新規作成 → 登録後に受信URLを差し込んで更新
 *   node scripts/slack-manifest-apply.mjs --manifest docs/slack-secretary-app-manifest.json --create
 *   node scripts/slack-manifest-apply.mjs --manifest docs/slack-secretary-app-manifest.json \
 *        --app A0XXXXXXX --events-url https://agentpm.app/api/channels/slack/webhook/<accountId>
 *
 * 注意:
 *   - manifest の event_subscriptions に request_url が無い場合、--events-url を渡さないと
 *     event_subscriptions ごと外して送る（Slack は URL 無しのイベント購読を受け付けないため）。
 *   - アイコン画像は manifest では変えられない（Basic Information で手動アップロード）。
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '').trim()]),
)
const token = env.SLACK_CONFIG_ACCESS_TOKEN
if (!token) {
  console.error('SLACK_CONFIG_ACCESS_TOKEN が .env.local にありません')
  process.exit(1)
}
const manifestPath = opt('--manifest', 'docs/slack-app-manifest.json')
const appId = opt('--app', env.SLACK_APP_ID || 'A0AF808AZ41')
const eventsUrl = opt('--events-url', null)

async function call(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  return r.json()
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.settings?.event_subscriptions) {
  if (eventsUrl) manifest.settings.event_subscriptions.request_url = eventsUrl
  else if (!manifest.settings.event_subscriptions.request_url) delete manifest.settings.event_subscriptions
}
// ボタン操作（Interactivity）はイベント購読と同じURLで受ける（秘書のリマインド確認ボタン用）
if (manifest.settings?.interactivity?.is_enabled) {
  if (eventsUrl) manifest.settings.interactivity.request_url = eventsUrl
  else if (!manifest.settings.interactivity.request_url) delete manifest.settings.interactivity
}

if (args.includes('--export')) {
  const res = await call('apps.manifest.export', { app_id: appId })
  console.log(JSON.stringify(res, null, 2))
  process.exit(res.ok ? 0 : 1)
}

const v = await call('apps.manifest.validate', args.includes('--create') ? { manifest } : { app_id: appId, manifest })
if (!v.ok) {
  console.error('検証エラー:', JSON.stringify(v, null, 2))
  process.exit(1)
}
console.log('検証 OK')
if (args.includes('--check')) process.exit(0)

if (args.includes('--create')) {
  const c = await call('apps.manifest.create', { manifest })
  if (!c.ok) {
    console.error('作成エラー:', JSON.stringify(c, null, 2))
    process.exit(1)
  }
  console.log('作成 OK')
  console.log(`  app_id:         ${c.app_id}`)
  console.log(`  設定ページ:     https://api.slack.com/apps/${c.app_id}`)
  console.log(`  signing_secret: ${c.credentials?.signing_secret ?? '(なし)'}`)
  console.log(`  client_id:      ${c.credentials?.client_id ?? '(なし)'}`)
  console.log('  次: 設定ページ → Install App → Bot User OAuth Token (xoxb-) を控える')
  process.exit(0)
}

const u = await call('apps.manifest.update', { app_id: appId, manifest })
if (!u.ok) {
  console.error('更新エラー:', JSON.stringify(u, null, 2))
  process.exit(1)
}
console.log('更新 OK', u.permissions_updated ? '（権限が変わったので、ワークスペースでの再インストールが必要です）' : '')

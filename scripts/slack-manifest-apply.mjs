#!/usr/bin/env node
/**
 * Slack アプリの設定（表示名・説明・スラッシュコマンド・URL・権限）を
 * docs/slack-app-manifest.json の内容で書き換える。
 *
 * 前提: .env.local に App Configuration Token を置く
 *   SLACK_CONFIG_ACCESS_TOKEN=xoxe.xoxp-...   （api.slack.com/apps → Your App Configuration Tokens → Generate）
 *   SLACK_APP_ID=A0AF808AZ41                  （省略時はこの値）
 *
 * 使い方:
 *   node scripts/slack-manifest-apply.mjs --export   # 今 Slack に入っている設定を表示するだけ
 *   node scripts/slack-manifest-apply.mjs --check    # 送る前の検証だけ
 *   node scripts/slack-manifest-apply.mjs            # 検証して書き換える
 *
 * 注意: アプリのアイコン画像は manifest では変えられない（Basic Information で手動アップロード）。
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '').trim()]),
)
const token = env.SLACK_CONFIG_ACCESS_TOKEN
const appId = env.SLACK_APP_ID || 'A0AF808AZ41'
if (!token) {
  console.error('SLACK_CONFIG_ACCESS_TOKEN が .env.local にありません')
  process.exit(1)
}

async function call(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  return r.json()
}

const manifest = JSON.parse(readFileSync('docs/slack-app-manifest.json', 'utf8'))

if (args.includes('--export')) {
  const res = await call('apps.manifest.export', { app_id: appId })
  console.log(JSON.stringify(res, null, 2))
  process.exit(res.ok ? 0 : 1)
}

const v = await call('apps.manifest.validate', { app_id: appId, manifest })
if (!v.ok) {
  console.error('検証エラー:', JSON.stringify(v, null, 2))
  process.exit(1)
}
console.log('検証 OK')
if (args.includes('--check')) process.exit(0)

const u = await call('apps.manifest.update', { app_id: appId, manifest })
if (!u.ok) {
  console.error('更新エラー:', JSON.stringify(u, null, 2))
  process.exit(1)
}
console.log('更新 OK', u.permissions_updated ? '（権限が変わったので、ワークスペースでの再インストールが必要です）' : '')

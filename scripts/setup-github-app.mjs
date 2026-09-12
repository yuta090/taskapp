#!/usr/bin/env node
/**
 * GitHub App を「マニフェスト方式」で作成し、鍵一式を回収するスクリプト。
 *
 * 人がやるのは、開いたブラウザで「Create GitHub App」を1回押すだけ。
 * 押した後の一時コードはこのスクリプトが受け取り、`gh api` で
 * App ID / Client ID / Client Secret / 秘密鍵 / Webhook Secret に変換して保存する。
 *
 * 使い方:
 *   node scripts/setup-github-app.mjs                    # 個人アカウント配下に作る
 *   node scripts/setup-github-app.mjs --org <GitHubOrg>  # 組織配下に作る
 *   node scripts/setup-github-app.mjs --name "AgentPM Dev" --base https://taskapp-git-develop-xxx.vercel.app
 *   node scripts/setup-github-app.mjs --vercel production  # 回収後に Vercel 環境変数へ投入
 *
 * 前提: `gh auth status` でログイン済みであること。
 */
import http from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GITHUB_APP_PERMISSIONS, GITHUB_APP_EVENTS } from '../src/lib/github/permissions.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const ORG = opt('--org', null)
const NAME = opt('--name', 'AgentPM')
const BASE = (opt('--base', 'https://agentpm.app')).replace(/\/$/, '')
const VERCEL_ENV = opt('--vercel', null)
const PORT = Number(opt('--port', '9876'))

try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' })
} catch {
  console.error('gh にログインしていません。先に `gh auth login` を実行してください。')
  process.exit(1)
}

const createUrl = ORG
  ? `https://github.com/organizations/${ORG}/settings/apps/new`
  : 'https://github.com/settings/apps/new'

// GitHub App Manifest: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
const manifest = {
  name: NAME,
  url: BASE,
  description: 'AgentPM: PR をタスクに自動で紐づけます',
  public: true,
  // インストール完了時に GitHub 側で利用者本人であることを確認するため、
  // インストールと同時に OAuth 認可も求め、installation_id・code・state を
  // まとめて callback_urls[0] で受け取る（setup_url ではなくこちらが使われる）
  request_oauth_on_install: true,
  callback_urls: [`${BASE}/api/github/callback`],
  setup_on_update: true,
  // 作成直後の一時コードはローカルで受け取る
  redirect_url: `http://localhost:${PORT}/callback`,
  hook_attributes: { url: `${BASE}/api/github/webhook`, active: true },
  default_permissions: GITHUB_APP_PERMISSIONS,
  default_events: [...GITHUB_APP_EVENTS],
}

const page = `<!doctype html><meta charset="utf-8"><title>AgentPM GitHub App</title>
<body style="font-family:system-ui;padding:32px;max-width:640px">
<h2>GitHub App を作成します</h2>
<p>次の画面で <b>Create GitHub App</b> を押してください。名前や権限は入力済みです。</p>
<form id="f" method="post" action="${createUrl}">
  <input type="hidden" name="manifest" id="m">
  <button style="font-size:16px;padding:8px 16px">GitHub を開く</button>
</form>
<pre style="background:#f4f4f4;padding:12px;font-size:12px">${JSON.stringify(manifest, null, 2).replace(/</g, '&lt;')}</pre>
<script>document.getElementById('m').value=${JSON.stringify(JSON.stringify(manifest))};</script>
</body>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(page)
  }
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code')
    if (!code) {
      res.writeHead(400).end('code がありません')
      return
    }
    let app
    try {
      const out = execFileSync('gh', ['api', '-X', 'POST', `/app-manifests/${code}/conversions`], { encoding: 'utf8' })
      app = JSON.parse(out)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('gh api の変換に失敗しました。ターミナルを確認してください。')
      console.error(e.stderr?.toString() || e)
      return
    }
    const creds = {
      GITHUB_APP_ID: String(app.id),
      GITHUB_APP_SLUG: app.slug,
      GITHUB_APP_CLIENT_ID: app.client_id,
      GITHUB_APP_CLIENT_SECRET: app.client_secret,
      GITHUB_APP_PRIVATE_KEY: app.pem,
      GITHUB_WEBHOOK_SECRET: app.webhook_secret,
      NEXT_PUBLIC_GITHUB_ENABLED: 'true',
    }
    const dir = join(homedir(), '.config', 'agentpm')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `github-app-${app.slug}.json`)
    writeFileSync(file, JSON.stringify({ html_url: app.html_url, ...creds }, null, 2), { mode: 0o600 })

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<body style="font-family:system-ui;padding:32px"><h2>完了</h2><p>鍵を保存しました: <code>${file}</code></p><p>このタブは閉じて構いません。</p></body>`)

    console.log('\n✅ GitHub App を作成しました')
    console.log(`   App ページ: ${app.html_url}`)
    console.log(`   保存先:     ${file}`)
    console.log('\n管理画面 (/admin/integrations) に貼る値:')
    for (const [k, v] of Object.entries(creds)) {
      if (k === 'GITHUB_APP_PRIVATE_KEY') console.log(`   ${k}: (PEM ${v.split('\n').length} 行・保存ファイル参照)`)
      else console.log(`   ${k}: ${v}`)
    }

    if (VERCEL_ENV) {
      console.log(`\nVercel (${VERCEL_ENV}) に環境変数を投入します...`)
      for (const [k, v] of Object.entries(creds)) {
        try {
          execFileSync('vercel', ['env', 'rm', k, VERCEL_ENV, '--yes'], { stdio: 'ignore' })
        } catch { /* 未登録なら無視 */ }
        execFileSync('vercel', ['env', 'add', k, VERCEL_ENV, '--force'], { input: v, stdio: ['pipe', 'inherit', 'inherit'] })
      }
      console.log('   投入完了。再デプロイすると有効になります。')
    }

    setTimeout(() => { server.close(); process.exit(0) }, 500)
    return
  }
  res.writeHead(404).end()
})

server.listen(PORT, () => {
  const local = `http://localhost:${PORT}/`
  console.log(`ブラウザを開きます: ${local}`)
  console.log(`作成先: ${createUrl}`)
  console.log('「GitHub を開く」→ GitHub 側で「Create GitHub App」を押してください。\n')
  spawn('open', [local], { stdio: 'ignore', detached: true }).unref()
})

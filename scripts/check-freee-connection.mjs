#!/usr/bin/env node
/**
 * freee 接続の疎通確認。
 *
 * 「アプリの権限設定でどれを選べばいいか」は画面の文言が製品・時期で変わるため、
 * 説明を読んで当てるより **実際に叩いて足りないものを名指しする** ほうが確実。
 * このスクリプトは認可を1回通したあと、TaskApp が実際に使う4つの経路を順に叩き、
 * どれが通ってどれが権限不足なのかを日本語で表示する。
 *
 * 使い方:
 *   node scripts/check-freee-connection.mjs
 *
 * 前提: .env.local に FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI。
 * dev サーバーは不要（ブラウザで認可 → 戻り先URLの ?code= を貼るだけ）。
 */

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const AUTHORIZE_URL = 'https://accounts.secure.freee.co.jp/public_api/authorize'
const TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'

function loadEnv() {
  let raw = ''
  try {
    raw = readFileSync('.env.local', 'utf8')
  } catch {
    fail('.env.local が読めません。リポジトリのルートで実行してください。')
  }
  const env = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

/** 事業所の一覧を取り、以降の確認に使う company_id を決める。 */
async function pickCompany(token) {
  const res = await fetch('https://api.freee.co.jp/api/1/companies', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    return { ok: false, detail: `${res.status} ${(await res.text()).slice(0, 160)}` }
  }
  const body = await res.json()
  const companies = body.companies ?? []
  return { ok: true, companies }
}

/**
 * TaskApp が実際に使う経路。ここが全部 ✓ になれば、権限設定は足りている。
 * 逆に ✗ が出たら、その行の「freeeの権限設定で必要なもの」を有効にして再実行する。
 */
function probes(companyId) {
  return [
    {
      label: '取引先の一覧を読む',
      why: '請求書の宛先を選ぶために使う',
      need: 'freee会計 の「取引先」の参照',
      url: `https://api.freee.co.jp/api/1/partners?company_id=${companyId}&limit=1`,
    },
    {
      label: '請求書の一覧を読む',
      why: '発行済み請求書の状態（入金済みかどうか）の取り込みに使う',
      need: 'freee請求書 の「請求書」の参照',
      url: `https://api.freee.co.jp/iv/invoices?company_id=${companyId}&limit=1`,
    },
    {
      label: '見積書の一覧を読む',
      why: '発行した見積書の状態の取り込みに使う',
      need: 'freee請求書 の「見積書」の参照',
      url: `https://api.freee.co.jp/iv/quotations?company_id=${companyId}&limit=1`,
    },
  ]
}

async function probe(token, target) {
  try {
    const res = await fetch(target.url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.ok) return { ok: true }
    const detail = (await res.text()).slice(0, 200)
    return { ok: false, status: res.status, detail }
  } catch (err) {
    return { ok: false, status: 0, detail: err.message }
  }
}

async function main() {
  const env = loadEnv()
  const clientId = env.FREEE_CLIENT_ID
  const clientSecret = env.FREEE_CLIENT_SECRET
  const redirectUri = env.FREEE_REDIRECT_URI

  if (!clientId) fail('.env.local の FREEE_CLIENT_ID が空です。')
  if (!clientSecret) fail('.env.local の FREEE_CLIENT_SECRET が空です。')
  if (!redirectUri) {
    fail('.env.local の FREEE_REDIRECT_URI が空です。freee のアプリ設定に登録した「コールバックURL」と同じ文字列を入れてください。')
  }

  const authorizeUrl =
    `${AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`

  console.log('\n─────────────────────────────────────────────')
  console.log(' freee 接続の確認')
  console.log('─────────────────────────────────────────────\n')
  console.log(' 1) 次のURLをブラウザで開いて、freee で「許可する」を押してください。\n')
  console.log(`    ${authorizeUrl}\n`)
  console.log(' 2) 許可すると、登録したコールバックURLに戻されます。')
  console.log('    そのときのアドレスバーに ?code=XXXX が付いているので、')
  console.log('    XXXX の部分（code の値）だけをコピーしてください。')
  console.log('    ※ページが「見つかりません」でも問題ありません。URLの code だけ使います。\n')

  const rl = createInterface({ input: stdin, output: stdout })
  const code = (await rl.question(' code を貼り付けて Enter: ')).trim()
  rl.close()

  if (!code) fail('code が空です。')

  console.log('\n  … トークンを取得しています')

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenRes.ok) {
    const detail = (await tokenRes.text()).slice(0, 300)
    console.error(`\n  ✗ トークンを取得できませんでした (${tokenRes.status})`)
    console.error(`     ${detail}\n`)
    if (detail.includes('redirect_uri')) {
      console.error('  よくある原因: FREEE_REDIRECT_URI と、freee のアプリ設定に登録した')
      console.error('  コールバックURLが1文字でも違う（末尾のスラッシュ有無も含めて一致が必要）。\n')
    }
    process.exit(1)
  }

  const tokens = await tokenRes.json()
  const token = tokens.access_token
  console.log('  ✓ トークンを取得しました\n')

  console.log('  … 事業所を確認しています')
  const companyResult = await pickCompany(token)
  if (!companyResult.ok) {
    console.error(`\n  ✗ 事業所の一覧を読めませんでした（${companyResult.detail}）`)
    console.error('     freee のアプリの権限設定で、事業所情報の参照を有効にしてください。\n')
    process.exit(1)
  }
  if (companyResult.companies.length === 0) {
    fail('この freee アカウントに事業所がありません。')
  }

  console.log('  ✓ 事業所が見つかりました:\n')
  for (const c of companyResult.companies) {
    console.log(`      company_id = ${c.id}   ${c.display_name ?? c.name ?? ''}`)
  }
  const companyId = companyResult.companies[0].id
  console.log(`\n    以降は company_id = ${companyId} で確認します。`)
  console.log('    （複数ある場合は、請求書を出す事業所のIDを控えてください）\n')

  console.log('─────────────────────────────────────────────')
  console.log(' TaskApp が使う経路の確認')
  console.log('─────────────────────────────────────────────\n')

  const missing = []
  for (const target of probes(companyId)) {
    const result = await probe(token, target)
    if (result.ok) {
      console.log(`  ✓ ${target.label}`)
    } else {
      console.log(`  ✗ ${target.label}  (${result.status})`)
      console.log(`      用途   : ${target.why}`)
      console.log(`      要る権限: ${target.need}`)
      if (result.detail) console.log(`      応答   : ${result.detail.slice(0, 120)}`)
      missing.push(target)
    }
    console.log('')
  }

  if (missing.length === 0) {
    console.log('─────────────────────────────────────────────')
    console.log(' すべて通りました。権限設定はこのままで大丈夫です。')
    console.log(` company_id = ${companyId} を控えて連絡してください。`)
    console.log('─────────────────────────────────────────────\n')
  } else {
    console.log('─────────────────────────────────────────────')
    console.log(` ${missing.length}件、権限が足りていません。`)
    console.log(' freee の「アプリ管理」→ 該当アプリ → 権限設定で、上の「要る権限」を')
    console.log(' 有効にして保存し、もう一度このスクリプトを実行してください。')
    console.log(' （権限を変えたら、認可のやり直しが必要です）')
    console.log('─────────────────────────────────────────────\n')
    process.exit(1)
  }
}

main().catch((err) => fail(err.message))

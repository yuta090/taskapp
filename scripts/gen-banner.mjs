#!/usr/bin/env node
/**
 * TASK6 記事バナーを、支給プロンプト（BANNER_PROMPT.md の本文・**変更禁止**）で生成する。
 *
 * 自分でプロンプトを書き直したり要約したりしない（地味になることが実証済み）。
 * このスクリプトは「案件固有ヘッダ」だけを受け取り、本文はファイルから丸ごと連結して agy に渡す。
 *
 * 使い方:
 *   node scripts/gen-banner.mjs <ヘッダのファイルパス> <出力PNGパス>
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROMPT_FILE = path.join(ROOT, 'docs/blog/BANNER_PROMPT.md')

const [headerPath, outPath] = process.argv.slice(2)
if (!headerPath || !outPath) {
  console.error('使い方: node scripts/gen-banner.mjs <ヘッダのファイル> <出力PNG>')
  process.exit(2)
}

const doc = fs.readFileSync(PROMPT_FILE, 'utf8')
const marker = '## 本文(支給プロンプト全文・変更禁止)'
const idx = doc.indexOf(marker)
if (idx < 0) {
  console.error(`${PROMPT_FILE} に本文の見出しが見つかりません`)
  process.exit(2)
}
// 見出しの次の行以降がすべて本文（一字一句そのまま使う）
const body = doc.slice(idx + marker.length).replace(/^\s*\n/, '')
const header = fs.readFileSync(headerPath, 'utf8').trim()

const prompt = `${header}\n\n${body}`
console.log(`プロンプト長: ${prompt.length}文字（うち支給本文 ${body.length}文字）`)

// agy はエイリアス（--dangerously-skip-permissions 付き）。子プロセスでは展開されないので明示する
const res = spawnSync(
  'agy',
  ['--dangerously-skip-permissions', '--print-timeout', '600s', '-p', prompt],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 },
)
console.log((res.stdout ?? '').split('\n').slice(-6).join('\n'))
if (res.stderr) console.error(res.stderr.split('\n').slice(-4).join('\n'))

if (fs.existsSync(outPath)) {
  const kb = Math.round(fs.statSync(outPath).size / 1024)
  console.log(`生成できました: ${outPath}（${kb}KB）`)
} else {
  console.error(`⚠ 生成物がありません: ${outPath}`)
  process.exit(1)
}

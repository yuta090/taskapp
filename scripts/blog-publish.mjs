#!/usr/bin/env node
/**
 * 下書き（docs/blog/DRAFT_*.md）を DB（blog_posts）へ反映する。
 *
 * なぜスクリプトにするか: 記事の正本はDBだが、原稿はリポジトリにある。手作業で貼ると
 * 両者がずれる（貼り忘れ・貼り間違い・CMS入力値の写し間違い）。下書きの
 * 「CMS入力値」ブロックをそのまま読み取って upsert する。
 *
 * 下書きの構造（この形を前提にする）:
 *   # 【下書き】タイトル
 *   > **CMS入力値（…）**            ← 引用ブロック内の表から slug/title/description/tags などを読む
 *   > | slug | `xxx` |
 *   ---                              ← ここから本文
 *   本文…
 *   ---                              ← 最後の区切り。以降（AI臭セルフチェック）は本文に含めない
 *
 * 使い方:
 *   node scripts/blog-publish.mjs docs/blog/DRAFT_xxx.md            # 下書きとして登録
 *   node scripts/blog-publish.mjs docs/blog/DRAFT_xxx.md --publish  # 公開する
 *   node scripts/blog-publish.mjs docs/blog/DRAFT_xxx.md --dry-run  # 中身だけ確認する
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENV_CANDIDATES = [
  path.join(ROOT, '.env.local'),
  '/Volumes/WIN-MAC2/scripts/taskapp/.env.local',
]

const [fileArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const doPublish = process.argv.includes('--publish')
const dryRun = process.argv.includes('--dry-run')
if (!fileArg) {
  console.error('使い方: node scripts/blog-publish.mjs <下書きファイル> [--publish] [--dry-run]')
  process.exit(2)
}

const raw = fs.readFileSync(path.resolve(ROOT, fileArg), 'utf8')

// --- CMS入力値の表を読む（引用ブロック内の `| キー | 値 |`）
const meta = {}
for (const line of raw.split('\n')) {
  const m = line.match(/^>\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/)
  if (!m) continue
  const key = m[1].trim()
  let val = m[2].trim()
  if (key === '項目' || /^-+$/.test(key)) continue
  val = val.replace(/^`|`$/g, '').replace(/`/g, '')
  meta[key] = val
}
for (const k of ['slug', 'title', 'description']) {
  if (!meta[k]) {
    console.error(`CMS入力値に ${k} がありません`)
    process.exit(2)
  }
}

// --- 本文を切り出す（最初の水平線の後 〜 最後の水平線の前）
const lines = raw.split('\n')
const hrIdx = lines.reduce((acc, l, i) => (l.trim() === '---' ? [...acc, i] : acc), [])
if (hrIdx.length < 2) {
  console.error('本文の区切り（--- 行）が2つ見つかりません')
  process.exit(2)
}
const body = lines
  .slice(hrIdx[0] + 1, hrIdx[hrIdx.length - 1])
  .join('\n')
  .trim()

// --- cover は「ファイル名だけ」でも公開URLに直す
const PUBLIC_PREFIX = (url) => `${url}/storage/v1/object/public/task6-covers/`
const tags = (meta.tags ?? '')
  .split(/[/／,、]/)
  .map((t) => t.trim())
  .filter(Boolean)

function readEnv(p, keys) {
  const text = fs.readFileSync(p, 'utf8')
  const out = {}
  for (const k of keys) {
    const m = text.match(new RegExp(`^${k}=(.*)$`, 'm'))
    if (m) out[k] = m[1].trim().replace(/^["']|["']$/g, '')
  }
  return out
}
const envPath = ENV_CANDIDATES.find((p) => fs.existsSync(p))
if (!envPath) {
  console.error('.env.local が見つかりません')
  process.exit(2)
}
const env = readEnv(envPath, ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])

let cover = meta.cover_image_url ?? ''
cover = cover.replace(/（.*?）|\(.*?\)/g, '').trim()
if (cover && !cover.startsWith('http')) cover = PUBLIC_PREFIX(env.NEXT_PUBLIC_SUPABASE_URL) + cover

const row = {
  slug: meta.slug,
  title: meta.title,
  description: meta.description,
  body_md: body,
  author_name: meta.author_name || '高橋ゆうこ',
  tags,
  noindex: meta.noindex === 'true',
  status: doPublish ? 'published' : 'draft',
  ...(cover ? { cover_image_url: cover } : {}),
  ...(doPublish ? { published_at: new Date().toISOString() } : {}),
}

console.log(`slug: ${row.slug}`)
console.log(`title: ${row.title}`)
console.log(`tags: ${tags.join('・') || '—'} / cover: ${cover || '—'} / status: ${row.status}`)
console.log(`本文: ${body.length}文字（先頭: ${body.slice(0, 40)}…）`)
if (dryRun) {
  console.log('--dry-run のため書き込みません')
  process.exit(0)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
// 既存があれば published_at は保持する（再公開で日付が動かないように）
const { data: existing } = await supabase
  .from('blog_posts')
  .select('id, published_at')
  .eq('slug', row.slug)
  .maybeSingle()
if (existing?.published_at && doPublish) row.published_at = existing.published_at

const { error } = await supabase.from('blog_posts').upsert(row, { onConflict: 'slug' })
if (error) {
  console.error(error)
  process.exit(1)
}
console.log(`${existing ? '更新' : '新規作成'}しました: /task6/${row.slug}`)

#!/usr/bin/env node
/**
 * 公開中のTASK6記事を機械的に検査する。
 *
 * 手で読み返すと、記事が増えるほど同じ荒を見落とす。実際に、社内の実例台帳ID（E-0XX）が
 * 本文に出たまま公開されていた記事が2本あった（2026-07-28に修正）。以後、公開のたびに通す。
 *
 * 使い方:
 *   node scripts/blog-audit.mjs           # 公開記事を検査（要対応があれば終了コード1）
 *   node scripts/blog-audit.mjs --all     # 下書きも含めて検査
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENV_CANDIDATES = [
  path.join(ROOT, '.env.local'),
  '/Volumes/WIN-MAC2/scripts/taskapp/.env.local',
]

/**
 * 検査項目。`except` は「その言い方が正しい文脈」を除外するための判定。
 * 語そのものを禁じると、歴史上の逸話や引用まで巻き込んで誤検知になる。
 */
const CHECKS = [
  { re: /E-0\d\d/, label: '社内台帳IDの露出' },
  { re: /いかがでし|と言えるでしょう|近年、|結論から言うと/, label: 'AI臭の定型' },
  { re: /検索窓|この記事では最後に|次回は|続きは/, label: 'メタ発言・続きの匂わせ' },
  { re: /することができます/, label: '冗長表現（→できます）' },
  {
    re: /助言/,
    label: '硬い和語（→アドバイス）',
    // 引用・逸話の中の「助言」は正しい。読者への呼びかけとして使っている場合だけを咎める
    except: (body) =>
      body
        .split('\n')
        .filter((l) => l.includes('助言'))
        .every((l) => /「|逸話|とされ|と伝わ|知られ|\d{4}/.test(l)),
  },
]

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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let query = supabase.from('blog_posts').select('slug, title, description, body_md, cover_image_url')
if (!process.argv.includes('--all')) query = query.eq('status', 'published')
const { data, error } = await query
if (error) {
  console.error(error)
  process.exit(2)
}

const slugs = new Set(data.map((p) => p.slug))
let ng = 0
for (const post of data) {
  const issues = []
  for (const c of CHECKS) {
    if (!c.re.test(post.body_md)) continue
    if (c.except?.(post.body_md)) continue
    issues.push(c.label)
  }
  if (!post.cover_image_url) issues.push('カバー画像が無い')
  if (!post.description || post.description.length < 60) issues.push('descriptionが短い')

  // 記事どうしのリンク（/task6/dl/... は配布ページなので記事リンクとは数えない）
  const linked = [...post.body_md.matchAll(/\]\(\/task6\/([a-z0-9-]+)\)/g)]
    .map((m) => m[1])
    .filter((s) => !post.body_md.includes(`/task6/dl/${s}`))
  for (const l of linked) if (!slugs.has(l)) issues.push(`リンク切れ /task6/${l}`)
  if (linked.length === 0) issues.push('内部リンクが0本')

  console.log(`${issues.length ? '⚠' : '✅'} ${post.slug}${issues.length ? ' — ' + issues.join(' / ') : ''}`)
  if (issues.length) ng++
}
console.log(`\n${data.length}本を検査 / 要対応 ${ng}本`)
process.exit(ng > 0 ? 1 : 0)

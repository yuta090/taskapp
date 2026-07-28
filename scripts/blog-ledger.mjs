#!/usr/bin/env node
/**
 * ブログ記事の台帳を、DB(blog_posts)から生成する。
 *
 * なぜ手書きの一覧にしないか: 手で書く台帳は必ず実態とずれる。実際に、別の作業で**執筆中(draft)**
 * だった記事と同じテーマを、確認せずに書いて公開してしまう事故が起きた(2026-07-28)。
 * 記事の正本はDBなので、台帳もDBから作る。
 *
 * ⚠ **draft を必ず含める**。今回の重複は「公開済みだけ見ていた」ことが原因。
 *
 * 使い方:
 *   node scripts/blog-ledger.mjs          # docs/blog/ARTICLE_LEDGER.md を更新
 *   node scripts/blog-ledger.mjs --check "キーワード"  # 似た記事が既にないか確認して終了コードで返す
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LEDGER = path.join(ROOT, 'docs/blog/ARTICLE_LEDGER.md')

function readEnv(p, keys) {
  const text = fs.readFileSync(p, 'utf8')
  const out = {}
  for (const k of keys) {
    const m = text.match(new RegExp(`^${k}=(.*)$`, 'm'))
    if (m) out[k] = m[1].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

// worktree には .env.local が無いことがあるので、メインの作業ディレクトリも見る
const ENV_CANDIDATES = [
  path.join(ROOT, '.env.local'),
  '/Volumes/WIN-MAC2/scripts/taskapp/.env.local',
]
const envPath = ENV_CANDIDATES.find((p) => fs.existsSync(p))
if (!envPath) {
  console.error('.env.local が見つかりません')
  process.exit(2)
}
const env = readEnv(envPath, ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('.env.local に接続情報がありません')
  process.exit(2)
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data, error } = await supabase
  .from('blog_posts')
  .select('slug, title, description, status, published_at, cover_image_url, tags, updated_at')
  .order('updated_at', { ascending: false })
if (error) {
  console.error(error)
  process.exit(2)
}

// --check: 似たテーマの記事が既にないかを調べる（書き始める前に通す）
const checkIdx = process.argv.indexOf('--check')
if (checkIdx >= 0) {
  const q = (process.argv[checkIdx + 1] ?? '').trim()
  if (!q) {
    console.error('--check にはキーワードを渡す')
    process.exit(2)
  }
  const hits = data.filter(
    (p) =>
      p.slug.includes(q) ||
      (p.title ?? '').includes(q) ||
      (p.description ?? '').includes(q) ||
      (p.tags ?? []).some((t) => t.includes(q)),
  )
  if (hits.length === 0) {
    console.log(`「${q}」に当たる既存記事はありません（draft含めて確認済み）`)
    process.exit(0)
  }
  console.log(`⚠ 「${q}」に当たる記事が ${hits.length} 件あります:`)
  for (const h of hits) console.log(`  [${h.status}] ${h.slug} — ${h.title}`)
  console.log('\n重複の可能性があります。書き始める前に、どちらを残すか決めてください。')
  process.exit(1)
}

const rows = data.map((p) => {
  const state = p.status === 'published' ? '公開' : p.status === 'draft' ? '**下書き**' : p.status
  const date = p.published_at ? p.published_at.slice(0, 10) : '—'
  const cover = p.cover_image_url ? '有' : '—'
  return `| ${state} | \`${p.slug}\` | ${p.title ?? ''} | ${(p.tags ?? []).join('・') || '—'} | ${date} | ${cover} |`
})

const published = data.filter((p) => p.status === 'published').length
const drafts = data.filter((p) => p.status !== 'published').length

const body = `# TASK6 記事台帳（DBから自動生成）

**このファイルは手で編集しない。** \`node scripts/blog-ledger.mjs\` で再生成する。

- 記事の正本は DB（\`blog_posts\`）。台帳はその写し
- **記事を書き始める前に必ず再生成して読む**。特に**下書き（draft）**は、別の作業で執筆中の
  可能性がある。ここを見ずに書いて、同じテーマの記事を二重に公開した事故がある（2026-07-28）
- テーマの重複確認は \`node scripts/blog-ledger.mjs --check "リマインくん"\` が速い

最終更新: ${new Date().toISOString().slice(0, 10)} ／ 公開 ${published}本・下書き ${drafts}本

| 状態 | slug | タイトル | タグ | 公開日 | カバー |
|---|---|---|---|---|---|
${rows.join('\n')}

## 書き始める前のチェック

1. \`node scripts/blog-ledger.mjs\` で台帳を更新する
2. 狙う検索語・テーマで \`--check\` を通す（**下書きも当たる**）
3. 当たったら、書き始める前に「どちらを残すか」を決める
4. 決まってから \`CONTENT_PLAN.md\` の制作一覧と突き合わせる
`

fs.writeFileSync(LEDGER, body, 'utf8')
console.log(`台帳を更新しました: ${path.relative(ROOT, LEDGER)}（公開${published}本・下書き${drafts}本）`)

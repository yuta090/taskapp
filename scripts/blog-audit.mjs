#!/usr/bin/env node
/**
 * 公開中のTASK6記事を機械的に検査する。
 *
 * 手で読み返すと、記事が増えるほど同じ荒を見落とす。実際に、社内の実例台帳ID（E-0XX）が
 * 本文に出たまま公開されていた記事が2本あった（2026-07-28に修正）。以後、公開のたびに通す。
 *
 * 使い方:
 *   node scripts/blog-audit.mjs            # 公開記事を検査（要対応があれば終了コード1）
 *   node scripts/blog-audit.mjs --all      # 下書きも含めて検査
 *   node scripts/blog-audit.mjs --openings # 書き出しの1文目を並べて目で確かめる
 *   node scripts/blog-audit.mjs --sections # 節の長さを測る（長い順。中見出しで割る判断に使う）
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
  {
    re: /いかがでし|と言えるでしょう|近年、|結論から言うと/,
    label: 'AI臭の定型',
    // 「その後いかがでしょうか」のように、催促メールの文面として鉤括弧で引用する用法は正しい。
    // 咎めるのは、記事が読者に向かって書いているときだけ
    except: (body) =>
      body
        .split('\n')
        .filter((l) => /いかがでし|と言えるでしょう|近年、|結論から言うと/.test(l))
        .every((l) => /「[^」]*(いかがでし|と言えるでしょう|近年、|結論から言うと)/.test(l)),
  },
  { re: /検索窓|この記事では最後に|次回は|続きは/, label: 'メタ発言・続きの匂わせ' },
  { re: /することができます/, label: '冗長表現（→できます）' },
  // 診断の実物とずれた案内。実装(src/app/shindan/)は 13問約3分 / 17問約5分、
  // 結果のグラフはメールなしで見られるが、型ごとの詳しい解説はメール登録の先にある
  { re: /登録不要|9つの型|9つのタイプ/, label: '診断の案内が実物とずれている' },
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

// --openings: 書き出しの1文目だけを並べる。
//
// なぜ機械で合否を出さないか: 「一覧」「表」「棒」が通じるかどうかは、その1文の中で
// 何が説明されているかで変わる（「今日やることの一覧」は通じる／「一覧」だけでは通じない）。
// 機械が判定すると誤検知だらけになり、警告そのものが読み飛ばされる。だから**並べて見せるだけ**にして、
// 判断は人がやる。実際に「朝いちばんに一覧を開くと」が公開まで通ってしまった（2026-07-30）。
//
// 書き出しは検索から来た人が最初に読む場所。**タイトルを見ていない人でも像が結べるか**で見る。
if (process.argv.includes('--openings')) {
  // 指示対象が特定されにくい一般名詞。どの記事にも出てくるので、これ単体では判定にならない
  const VAGUE = ['一覧', 'シート', '棒', 'リスト', '表', 'グループ', '課題', 'データベース', '件']
  console.log('書き出しの1文目（★の語は、修飾なしだと何を指すか分からなくなる語）\n')
  for (const post of data) {
    const first = (post.body_md.split('\n').find((l) => l.trim()) ?? '').trim()
    const hits = VAGUE.filter((w) => first.includes(w))
    console.log(`■ ${post.slug}`)
    console.log(`  ${first}`)
    if (hits.length) console.log(`  ★ ${hits.map((w) => `「${w}」`).join('・')} — その語の前に、何の${hits[0]}かを書いたか？`)
    console.log()
  }
  console.log('判定は人がやる。1文目の名詞を1つずつ指して「これは何？」と聞き、')
  console.log('タイトルを見ていない人でも像が結べるかを確かめる。')
  process.exit(0)
}

// --sections: 見出しから次の見出しまでの字数を測る。
//
// 節が長いかどうかは目では分からない。実際に、1,261字・中見出しゼロの節が公開まで通っていた
// （手順の頭を太字で書いていたため、書き手には見出しに見えていた／2026-07-30）。
// 目安は500字。ただし中身が箇条書き・Q&A・締めのリストなら長くても読めるので、判断は人がやる。
if (process.argv.includes('--sections')) {
  const rows = []
  for (const post of data) {
    let cur = null
    for (const line of post.body_md.split('\n')) {
      if (/^#{2,3} /.test(line)) {
        if (cur) rows.push(cur)
        cur = { slug: post.slug, head: line.replace(/^#+ /, ''), level: line.startsWith('### ') ? 3 : 2, chars: 0, list: 0 }
        continue
      }
      if (!cur) continue
      cur.chars += line.trim().length
      if (/^[-*] |^\d+\. /.test(line.trim())) cur.list += line.trim().length
    }
    if (cur) rows.push(cur)
  }
  rows.sort((a, b) => b.chars - a.chars)
  console.log('節の長さ（長い順・400字超のみ）。目安500字。listはそのうち箇条書きの字数\n')
  for (const r of rows.filter((r) => r.chars > 400)) {
    const mark = r.chars > 500 && r.chars - r.list > 500 ? '★' : ' '
    console.log(`${mark}${String(r.chars).padStart(4)}字（list${String(r.list).padStart(3)}）H${r.level} [${r.slug}] ${r.head}`)
  }
  const over = rows.filter((r) => r.chars - r.list > 500).length
  console.log(`\n全${rows.length}節 / ★（箇条書きを除いて500字超）${over}節`)
  console.log('★は中見出しで割るか、段落を削るかを検討する。判断は人がやる。')
  process.exit(0)
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
  if (post.description && post.description.length > 130) issues.push('descriptionが長い（130字超）')
  // descriptionは検索結果に単独で出るので、記事の中で説明している言葉は使えない。
  // 「ボール」はこのサイト固有の言い方、「一本道」は記事内で定義した比喩（実例あり・2026-07-30）
  for (const w of ['ボール', '一本道']) {
    if (post.description?.includes(w)) issues.push(`descriptionに記事内だけの言葉「${w}」`)
  }

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

#!/usr/bin/env node
/**
 * 公開中の記事を機械的に検査する。
 *
 * 手で読み返すと、記事が増えるほど同じ荒を見落とす。実際に、社内の実例台帳のID（E-0XX）が
 * 本文に出たまま公開されていた記事が2本あった。以後、公開のたびに通す。
 *
 * ⚠ **機械検査はレビューの代わりにならない。** 見るのは定型パターンだけで、
 *   その1文が読者に通じるかは判定できない。工程は「敵対的レビュー → 修正 → 機械検査」。
 *
 * 使い方:
 *   node scripts/blog-audit.mjs            # 公開記事を検査（要対応があれば終了コード1）
 *   node scripts/blog-audit.mjs --all      # 下書きも含めて検査
 *   node scripts/blog-audit.mjs --openings # 書き出しの1文目を並べて目で確かめる
 *   node scripts/blog-audit.mjs --sections # 節の長さを測る（長い順。中見出しで割る判断に使う）
 */
import { loadConfig, listPosts } from './blog-config.mjs'

const cfg = loadConfig()

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

// 案件ごとの検査は blog.config.json の projectChecks で足す
// 例: [{ "re": "登録不要|9つの型", "label": "診断の案内が実物とずれている" }]
for (const c of cfg.projectChecks ?? []) CHECKS.push({ re: new RegExp(c.re), label: c.label })

const data = await listPosts(cfg, { includeDrafts: process.argv.includes('--all') })

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
        cur = { slug: post.slug, head: line.replace(/^#+ /, ''), level: line.startsWith('### ') ? 3 : 2, chars: 0, run: 0, maxRun: 0 }
        continue
      }
      if (!cur) continue
      const t = line.trim()
      cur.chars += t.length
      // 読者の目にとっての「区切り」は中見出しだけではない。箇条書き・引用・Q&A・
      // 段落頭の太字ラベル（**見分け方**：など）も面が変わるので、そこでかたまりが切れる。
      // ここを数えないと、実際は読みやすい節まで「長すぎ」と鳴り、警告が読み飛ばされる
      // Q&A（**Q. …**）は本文が長くても区切り。太字ラベル（**見分け方**：）は短いものだけ
      const isBreak =
        /^[-*] |^\d+\. |^> |^\{\{/.test(t) ||
        /^\*\*Q[.．]/.test(t) ||
        /^\*\*[^*]{1,14}\*\*[：:]/.test(t) ||
        /^\*\*[^*]{1,10}\*\*「/.test(t) // 対話劇の話者ラベル（**ガント**「…）も面が変わる
      if (isBreak) cur.run = 0
      else cur.run += t.length
      if (cur.run > cur.maxRun) cur.maxRun = cur.run
    }
    if (cur) rows.push(cur)
  }
  rows.sort((a, b) => b.maxRun - a.maxRun)
  console.log('区切りなしで続く最長のかたまり（長い順・300字超のみ）。目安500字\n')
  console.log('区切り＝中見出し・箇条書き・引用・Q&A・段落頭の太字ラベル\n')
  for (const r of rows.filter((r) => r.maxRun > 300)) {
    const mark = r.maxRun > 500 ? '★' : ' '
    console.log(`${mark}${String(r.maxRun).padStart(4)}字（節全体${String(r.chars).padStart(4)}）H${r.level} [${r.slug}] ${r.head}`)
  }
  const over = rows.filter((r) => r.maxRun > 500).length
  console.log(`\n全${rows.length}節 / ★（区切りなしで500字超）${over}節`)
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
  // 対象語は blog.config.json の insiderWords に案件ごとに書く（例: サイト固有の呼び名・記事内で定義した比喩）
  for (const w of cfg.insiderWords) {
    if (post.description?.includes(w)) issues.push(`descriptionに記事内だけの言葉「${w}」`)
  }

  // 記事どうしのリンク（articleUrlPattern に一致するものだけを数える）
  const prefix = cfg.articleUrlPattern.replace('{slug}', '')
  const linkRe = new RegExp(`\\]\\(${prefix.replace(/[/]/g, '\\/')}([a-z0-9-]+)\\)`, 'g')
  const linked = [...post.body_md.matchAll(linkRe)].map((m) => m[1])
  for (const l of linked) if (!slugs.has(l)) issues.push(`リンク切れ ${cfg.articleUrlPattern.replace('{slug}', l)}`)
  if (linked.length === 0) issues.push('内部リンクが0本')

  console.log(`${issues.length ? '⚠' : '✅'} ${post.slug}${issues.length ? ' — ' + issues.join(' / ') : ''}`)
  if (issues.length) ng++
}
console.log(`\n${data.length}本を検査 / 要対応 ${ng}本`)
process.exit(ng > 0 ? 1 : 0)

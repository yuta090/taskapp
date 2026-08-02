/**
 * 記事スクリプト共通の設定読み込み。
 *
 * このスキルを別のプロジェクトへ持っていけるようにするため、**案件ごとに変わる値は
 * すべてここに集める**。スクリプト側にプロジェクト名・テーブル名・絶対パスを書かない。
 *
 * 使い方: プロジェクトのルートに `blog.config.json` を置く（`blog.config.example.json` を写す）。
 * 置かなければ下の既定値で動く。
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULTS = {
  // 記事の保管方式。'supabase' = DBに入れる / 'files' = Markdownファイルをそのまま正本にする
  store: 'supabase',
  // 下書きの置き場（プロジェクトルートからの相対）
  draftsDir: 'docs/blog',
  // 下書きのファイル名の頭
  draftPrefix: 'DRAFT_',
  // 記事の台帳を書き出す先
  ledgerPath: 'docs/blog/ARTICLE_LEDGER.md',
  // 記事の公開URLの形（{slug} を置き換える）。内部リンクの検査に使う
  articleUrlPattern: '/blog/{slug}',
  supabase: {
    // 接続情報を書いたファイル（プロジェクトルートからの相対）。見つからなければ環境変数を使う
    envFile: '.env.local',
    urlKey: 'NEXT_PUBLIC_SUPABASE_URL',
    serviceKeyKey: 'SUPABASE_SERVICE_ROLE_KEY',
    table: 'blog_posts',
    // カバー画像を置く公開バケット。空なら cover_image_url をそのまま使う
    coversBucket: '',
  },
  // 記事の中でだけ通じる言い方（description に出ていたら警告する）。案件ごとに足す
  insiderWords: [],
  // 画像プロンプトの正本（あれば。無ければ空でよい）
  bannerPromptPath: 'docs/blog/BANNER_PROMPT.md',
}

function deepMerge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] ?? {}, v) : v
  }
  return out
}

/** プロジェクトのルート = `blog.config.json` があるところ。無ければ cwd */
export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'blog.config.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return path.resolve(start)
    dir = up
  }
}

export function loadConfig(start = process.cwd()) {
  const root = findRoot(start)
  const p = path.join(root, 'blog.config.json')
  const file = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}
  return { root, ...deepMerge(DEFAULTS, file) }
}

/** .env ファイルか環境変数から値を取る。ファイルが無くても環境変数があれば動く */
export function readSecrets(cfg, keys) {
  const out = {}
  const p = path.join(cfg.root, cfg.supabase.envFile)
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  for (const k of keys) {
    const m = text.match(new RegExp(`^${k}=(.*)$`, 'm'))
    out[k] = (m ? m[1] : process.env[k] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** Supabase クライアント。store が 'supabase' のときだけ使う */
export async function getSupabase(cfg) {
  if (cfg.store !== 'supabase') throw new Error(`store が 'supabase' ではありません: ${cfg.store}`)
  const { createClient } = await import('@supabase/supabase-js')
  const s = readSecrets(cfg, [cfg.supabase.urlKey, cfg.supabase.serviceKeyKey])
  const url = s[cfg.supabase.urlKey]
  const key = s[cfg.supabase.serviceKeyKey]
  if (!url || !key) {
    console.error(
      `接続情報がありません。${cfg.supabase.envFile} か環境変数に ` +
        `${cfg.supabase.urlKey} と ${cfg.supabase.serviceKeyKey} を設定してください`,
    )
    process.exit(2)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * 公開中の記事を読む。store の違いをここで吸収するので、各スクリプトは
 * `{ slug, title, description, body_md, cover_image_url, tags, status, published_at }`
 * の配列だけを見ればよい。
 */
export async function listPosts(cfg, { includeDrafts = false } = {}) {
  if (cfg.store === 'files') {
    const dir = path.join(cfg.root, cfg.draftsDir)
    if (!fs.existsSync(dir)) return []
    const posts = []
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      const meta = parseMetaBlock(src)
      if (!meta.slug) continue
      if (!includeDrafts && (meta.status ?? 'published') !== 'published') continue
      posts.push({ ...meta, body_md: extractBody(src) })
    }
    return posts
  }
  const sb = await getSupabase(cfg)
  let q = sb
    .from(cfg.supabase.table)
    .select('slug, title, description, body_md, cover_image_url, tags, status, published_at')
  if (!includeDrafts) q = q.eq('status', 'published')
  const { data, error } = await q
  if (error) {
    console.error(error)
    process.exit(2)
  }
  return data
}

/** 下書きの先頭にある引用ブロックの表（`> | キー | 値 |`）を読む */
export function parseMetaBlock(src) {
  const meta = {}
  for (const line of src.split('\n')) {
    const m = line.match(/^>\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/)
    if (!m) continue
    const key = m[1].trim()
    if (key === '項目' || /^-+$/.test(key)) continue
    meta[key] = m[2].trim().replace(/`/g, '')
  }
  return meta
}

/** 本文＝最初の水平線の次 〜 最後の水平線の前（執筆メモを本文に混ぜない） */
export function extractBody(src) {
  const lines = src.split('\n')
  const hr = lines.reduce((a, l, i) => (l.trim() === '---' ? [...a, i] : a), [])
  if (hr.length < 2) return src.trim()
  return lines
    .slice(hr[0] + 1, hr[hr.length - 1])
    .join('\n')
    .trim()
}

/**
 * 流入経路（どこから来て登録したか）の first-touch 記録。
 *
 * 流れ:
 *   1. proxy（全ページの門番）が、URL のパラメータ（utm_* / ref / gclid 等）か外部サイトからの
 *      参照元がある最初の訪問で cookie `agentpm_ft` を置く。既にあれば上書きしない（first-touch）。
 *      静的LP（/lp1 等）にも効く。Google ログイン経由の登録でも cookie は残る。
 *   2. 組織作成（onboarding）で cookie を読み、流入経路（channel）を判定して
 *      rpc_record_org_acquisition で org_acquisition に記録する。
 *   3. 運営は /admin/organizations/[id] から手で上書きできる（sales / event 等）。
 *
 * 既存の記事計測（/signup の ?ref=task6&art=<slug> → user metadata）はそのまま残す。
 * ここは「組織単位・全経路」の記録で、記事別の集計はこれまで通り metadata でも取れる。
 */

export const FIRST_TOUCH_COOKIE = 'agentpm_ft'
/** first-touch cookie の寿命（日）。広告→検討→登録の間隔をカバーする */
export const FIRST_TOUCH_COOKIE_MAX_AGE_SEC = 90 * 86400

export type AcquisitionChannel =
  | 'task6_article'
  | 'shindan'
  | 'organic_search'
  | 'ai_search'
  | 'paid_ad'
  | 'sns'
  | 'referral'
  | 'email'
  | 'sales'
  | 'event'
  | 'direct'
  | 'other'
  | 'unknown'

export const ACQUISITION_CHANNEL_LABEL: Readonly<Record<AcquisitionChannel, string>> = {
  task6_article: '記事（TASK6）',
  shindan: 'タスク滞留診断',
  organic_search: '検索',
  ai_search: 'AI検索（ChatGPT 等）',
  paid_ad: '広告',
  sns: 'SNS',
  referral: '紹介・他サイト',
  email: 'メール',
  sales: '営業・直接の紹介',
  event: 'セミナー・イベント',
  direct: '直接（URL・ブックマーク）',
  other: 'その他',
  unknown: '不明',
}

export const ALL_ACQUISITION_CHANNELS = Object.keys(ACQUISITION_CHANNEL_LABEL) as AcquisitionChannel[]

/** 運営が手で登録するときの候補（unknown は選ばせない） */
export const MANUAL_ACQUISITION_CHANNELS: readonly AcquisitionChannel[] = ALL_ACQUISITION_CHANNELS.filter(
  (c) => c !== 'unknown',
)

export function isAcquisitionChannel(v: unknown): v is AcquisitionChannel {
  return typeof v === 'string' && v in ACQUISITION_CHANNEL_LABEL
}

export function getAcquisitionChannelLabel(channel: string): string {
  return isAcquisitionChannel(channel) ? ACQUISITION_CHANNEL_LABEL[channel] : channel
}

export interface FirstTouch {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  /** 記事計測の ref（task6 / shindan） */
  ref?: string
  /** 記事 slug */
  art?: string
  /** 広告クリック ID の種類（gclid 等）。値そのものは保存しない */
  click_id?: string
  /** 外部の参照元ホスト名 */
  referrer?: string
  /** 最初に着地したパス */
  landing_path: string
  /** ISO 時刻 */
  at: string
}

const MAX_VALUE_LEN = 100
const MAX_PATH_LEN = 200
/**
 * 英数・記号の一部だけ許す（HTML や制御文字を持ち込ませない）。
 * '@' と '%' は通さない: メールアドレスや URL エンコードされた個人情報が
 * utm の値に紛れ込んで cookie / DB に 90 日残るのを避ける（キャンペーン名に '@' は不要）。
 */
const SAFE_VALUE_RE = /^[A-Za-z0-9 _\-.:/+!()]{1,100}$/
const SAFE_SLUG_RE = /^[a-z0-9-]{1,64}$/
const KNOWN_REFS = new Set(['task6', 'shindan'])
const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'yclid', 'msclkid', 'fbclid', 'ttclid', 'li_fat_id'] as const
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

function cleanValue(raw: string | null): string | undefined {
  if (!raw) return undefined
  const v = raw.trim().slice(0, MAX_VALUE_LEN)
  return SAFE_VALUE_RE.test(v) ? v : undefined
}

/**
 * 合鍵（トークン）を URL に含むページ。着地パスとして cookie / DB に残すのは先頭の区切りだけにする
 * （招待リンク /invite/<合鍵> や相手先ポータル /portal/<合鍵> をそのまま保存しない）
 */
const TOKEN_PATH_PREFIXES = new Set(['invite', 'portal', 'reset', 'auth', 'api', 'p'])

/** 着地パスを安全な形にする: 合鍵を含み得るページは先頭区切りだけ、長さは上限まで */
export function sanitizeLandingPath(pathname: string): string {
  const [, first = ''] = pathname.split('/')
  if (TOKEN_PATH_PREFIXES.has(first)) return `/${first}`
  return pathname.slice(0, MAX_PATH_LEN)
}

/**
 * 認証事業者のホスト。ログインの戻り（Google / Supabase / LINE 等）を「検索」「紹介」と誤判定しないため、
 * 参照元としては無視する
 */
const AUTH_PROVIDER_HOST_RE =
  /(^|\.)(accounts\.google\.com|supabase\.co|supabase\.in|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com|access\.line\.me|github\.com\/login|slack\.com\/oauth)$/

function refererHost(referer: string | null): string | null {
  if (!referer) return null
  try {
    return new URL(referer).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * リクエストの URL と Referer から first-touch を組み立てる。
 * 「手がかり」（utm / ref / クリック ID / 外部参照元）が何も無ければ null（cookie を置かない）。
 */
export function extractFirstTouch(url: URL, referer: string | null, nowIso: string): FirstTouch | null {
  const params = url.searchParams
  const ft: FirstTouch = { landing_path: sanitizeLandingPath(url.pathname), at: nowIso }
  let hasSignal = false

  for (const key of UTM_KEYS) {
    const v = cleanValue(params.get(key))
    if (v) {
      ft[key] = v
      hasSignal = true
    }
  }

  const ref = params.get('ref')
  if (ref && KNOWN_REFS.has(ref)) {
    ft.ref = ref
    hasSignal = true
    const art = params.get('art')
    if (art && SAFE_SLUG_RE.test(art)) ft.art = art
  }

  for (const key of CLICK_ID_PARAMS) {
    if (params.has(key)) {
      ft.click_id = key
      hasSignal = true
      break
    }
  }

  const host = refererHost(referer)
  if (host && host !== url.hostname.toLowerCase() && host !== 'localhost' && !AUTH_PROVIDER_HOST_RE.test(host)) {
    ft.referrer = host.slice(0, MAX_VALUE_LEN)
    hasSignal = true
  }

  return hasSignal ? ft : null
}

export function encodeFirstTouchCookie(ft: FirstTouch): string {
  return encodeURIComponent(JSON.stringify(ft))
}

export function decodeFirstTouchCookie(raw: string | null | undefined): FirstTouch | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.landing_path !== 'string' || typeof obj.at !== 'string') return null
    const out: FirstTouch = { landing_path: sanitizeLandingPath(obj.landing_path), at: obj.at }
    for (const key of [...UTM_KEYS, 'ref', 'art', 'click_id', 'referrer'] as const) {
      const v = obj[key]
      if (typeof v === 'string' && v.length > 0) out[key] = v.slice(0, MAX_VALUE_LEN)
    }
    return out
  } catch {
    return null
  }
}

const SEARCH_HOST_RE =
  /(^|\.)(google\.[a-z.]+|bing\.com|search\.yahoo\.(co\.jp|com)|yahoo\.co\.jp|duckduckgo\.com|yandex\.[a-z]+|baidu\.com|ecosia\.org|naver\.com)$/
const AI_HOST_RE =
  /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|bing\.com\/chat|you\.com|felo\.ai|genspark\.ai)$/
const SNS_HOST_RE =
  /(^|\.)(twitter\.com|x\.com|t\.co|facebook\.com|fb\.me|instagram\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|note\.com|threads\.net|tiktok\.com|line\.me|pinterest\.com|reddit\.com)$/
const SNS_SOURCES = new Set([
  'twitter', 'x', 'facebook', 'instagram', 'linkedin', 'youtube', 'note', 'threads', 'tiktok', 'line', 'social', 'sns',
])
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'display', 'cpm', 'cpv', 'ad', 'ads', 'banner'])

/**
 * first-touch から流入経路を判定する。cookie が無ければ direct。
 * 判定順: 記事/診断 → 広告 → メール → SNS → 紹介(utm) → 検索 → AI検索 → SNS(参照元) → 紹介(参照元) → direct
 */
export function deriveAcquisitionChannel(ft: FirstTouch | null): AcquisitionChannel {
  if (!ft) return 'direct'
  if (ft.ref === 'task6') return 'task6_article'
  if (ft.ref === 'shindan') return 'shindan'

  const medium = ft.utm_medium?.toLowerCase()
  const source = ft.utm_source?.toLowerCase()

  if (ft.click_id || (medium && PAID_MEDIUMS.has(medium))) return 'paid_ad'
  if (medium === 'email' || medium === 'newsletter' || source === 'newsletter' || source === 'mail') return 'email'
  if ((medium && SNS_SOURCES.has(medium)) || (source && SNS_SOURCES.has(source))) return 'sns'
  if (medium === 'referral') return 'referral'
  if (medium === 'organic' || source === 'organic') return 'organic_search'

  const host = ft.referrer?.toLowerCase()
  if (host) {
    if (SEARCH_HOST_RE.test(host)) return 'organic_search'
    if (AI_HOST_RE.test(host)) return 'ai_search'
    if (SNS_HOST_RE.test(host)) return 'sns'
    return 'referral'
  }

  if (source || medium || ft.utm_campaign) return 'other'
  return 'direct'
}

/** rpc_record_org_acquisition の p_data */
export interface AcquisitionRecord {
  channel: AcquisitionChannel
  ref?: string
  article_slug?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  click_id?: string
  landing_path?: string
  referrer?: string
  first_touch_at?: string
}

export function buildAcquisitionRecord(ft: FirstTouch | null): AcquisitionRecord {
  const channel = deriveAcquisitionChannel(ft)
  if (!ft) return { channel }
  const rec: AcquisitionRecord = { channel }
  if (ft.ref) rec.ref = ft.ref
  if (ft.art) rec.article_slug = ft.art
  for (const key of UTM_KEYS) if (ft[key]) rec[key] = ft[key]
  if (ft.click_id) rec.click_id = ft.click_id
  if (ft.landing_path) rec.landing_path = ft.landing_path
  if (ft.referrer) rec.referrer = ft.referrer
  if (ft.at) rec.first_touch_at = ft.at
  return rec
}

/**
 * ブログCMS の入力バリデーション。
 * DB の check 制約と対になっており、API 層で先に弾いて分かりやすいエラーを返す。
 */

export const POST_STATUSES = ['draft', 'published', 'archived'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const CTA_VARIANTS = ['inline', 'band', 'card'] as const
export type CtaVariant = (typeof CTA_VARIANTS)[number]

const SLUG_RE = /^[a-z0-9-]+$/
const KEY_RE = /^[a-z0-9-]+$/
// 相対パス(/...) か https:// のみ。javascript:/http:/mailto: 等を排除
const URL_RE = /^(\/|https:\/\/)/

export function isValidSlug(slug: unknown): boolean {
  return typeof slug === 'string' && slug.length >= 1 && slug.length <= 120 && SLUG_RE.test(slug)
}

export function isValidButtonUrl(url: unknown): boolean {
  return typeof url === 'string' && URL_RE.test(url)
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

export function validatePostInput(input: Record<string, unknown>): ValidationResult {
  const { slug, title, description, status } = input

  if (!isValidSlug(slug)) {
    return { ok: false, error: 'slug は小文字英数とハイフンのみ（1〜120文字）にしてください' }
  }
  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 120) {
    return { ok: false, error: 'title は1〜120文字にしてください' }
  }
  if (description != null && (typeof description !== 'string' || description.length > 200)) {
    return { ok: false, error: 'description は200文字以内にしてください' }
  }
  if (status != null && !POST_STATUSES.includes(status as PostStatus)) {
    return { ok: false, error: `status は ${POST_STATUSES.join(' / ')} のいずれかにしてください` }
  }
  return { ok: true }
}

export function validateCtaInput(input: Record<string, unknown>): ValidationResult {
  const { key, name, heading, body, button_label, button_url, variant } = input

  if (typeof key !== 'string' || !KEY_RE.test(key) || key.length > 60) {
    return { ok: false, error: 'key は小文字英数とハイフンのみ（1〜60文字）にしてください' }
  }
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 120) {
    return { ok: false, error: 'name は1〜120文字にしてください' }
  }
  if (typeof heading !== 'string' || heading.trim().length < 1 || heading.length > 200) {
    return { ok: false, error: 'heading は1〜200文字にしてください' }
  }
  if (body != null && (typeof body !== 'string' || body.length > 500)) {
    return { ok: false, error: 'body は500文字以内にしてください' }
  }
  if (typeof button_label !== 'string' || button_label.trim().length < 1 || button_label.length > 60) {
    return { ok: false, error: 'button_label は1〜60文字にしてください' }
  }
  if (!isValidButtonUrl(button_url)) {
    return { ok: false, error: 'button_url は / または https:// で始まる必要があります' }
  }
  if (variant != null && !CTA_VARIANTS.includes(variant as CtaVariant)) {
    return { ok: false, error: `variant は ${CTA_VARIANTS.join(' / ')} のいずれかにしてください` }
  }
  return { ok: true }
}

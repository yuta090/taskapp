/**
 * メールの差出人（From）と返信先（Reply-To）を1か所で組み立てる。
 *
 * 方針（Fable 裁定 2026-09-07）: 相手先に届くメールは From 表示名を「{事務所名} (AgentPM)」にし（**有料プランの事務所だけ**。
 * 無料登録の組織名でなりすましメールを作れないようにする。判定は senderOrgName.ts）、
 * 返信先を操作した担当者にする。アドレス自体は FROM_EMAIL のまま（自社ドメイン From はやらない）。
 * 「事務所からのメールに見えて返信してしまう」のを Reply-To で担当者に届くようにして吸収する。
 * 運営宛・課金宛・認証メールは表示名「AgentPM」のみ（事務所名は付けない）。
 */

const FALLBACK_FROM = 'noreply@taskapp.example.com'
const MAX_DISPLAY_NAME = 60

let fromEmailWarned = false

/** @internal テスト用: 警告の「1回だけ」をリセット */
export function resetFromEmailWarning() {
  fromEmailWarned = false
}

export function getFromEmail(): string {
  const fromEmail = process.env.FROM_EMAIL
  if (!fromEmail && !fromEmailWarned) {
    console.warn('[email] FROM_EMAIL が未設定です。本番ではメールが届かない可能性があります。')
    fromEmailWarned = true
  }
  return fromEmail || FALLBACK_FROM
}

export function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || 'AgentPM'
}

/**
 * ヘッダを壊す／解釈が揺れる文字（引用符・山かっこ・カンマ・セミコロン・バックスラッシュ・制御文字）を除き、長すぎれば切る。
 * 「Acme, Inc.」のような社名もカンマ抜きで載せる（Resend 側の解釈に賭けて届かなくなるより安全）
 */
export function sanitizeDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[",;<>\\\u0000-\u001F]/g, '').trim().slice(0, MAX_DISPLAY_NAME)
}

/**
 * From ヘッダ。orgName があれば「{事務所名} (AgentPM)」、無ければ「AgentPM」。
 * 表示名は常にダブルクォートで囲む（日本語は Resend/RFC 2047 側で符号化される）。
 */
export function buildFrom(opts: { orgName?: string | null } = {}): string {
  const app = sanitizeDisplayName(getAppName())
  const org = opts.orgName ? sanitizeDisplayName(opts.orgName) : ''
  const display = org ? `${org} (${app})` : app
  return `"${display}" <${getFromEmail()}>`
}

const EMAIL_RE = /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;]+$/

/** Reply-To に使えるのはメールアドレスの形のときだけ（改行等のヘッダ注入を防ぐ） */
export function sanitizeReplyTo(email: string | null | undefined): string | undefined {
  if (!email) return undefined
  const v = email.trim()
  return EMAIL_RE.test(v) ? v : undefined
}

/**
 * なりすましログイン対策: 新しい端末（ブラウザ）からの初回ログインを検知して本人に通知する。
 *
 * 端末の識別は httpOnly cookie（agentpm_device・ランダム32byte hex、名前・検証・オプションは
 * ./deviceCookie.ts）。この cookie の device_id が `user_known_devices` に無ければ「新しい端末」と
 * 判定し、本人のメールに通知する。同じ端末からの2回目以降（cookie が既にあり、行も既にある）は送らない。
 *
 * 呼び出し元は `src/proxy.ts`（門番）から `POST /api/auth/login-notify` への内部fetch経由の1箇所に
 * 一本化している（Fable裁定 2026-09-07: パスワードログイン画面・Googleコールバックそれぞれに実装すると
 * 経路が増えるたびに対応が要るため、"認証済みで保護ページに来た"ことを検知できる門番に寄せた）。
 *
 * 検知の限界（意図した設計であり、脱漏ではない）:
 * - 画面を一度も経由せず Supabase の認証APIを直接叩く攻撃者は検知できない（門番はページ遷移でしか
 *   発火しないため）。
 * - cookie ごとセッションを盗まれた場合は「その cookie を持つ端末」として既知扱いになり検知できない。
 * - 同じ端末（同じブラウザ）を複数人で共有している場合は区別できない。
 * 目的は不正検知システムではなく、善良な利用者に「見覚えのないログインがあった」ことを知らせること。
 *
 * server 専用（service role を使う）。'use client' から import しない。
 */
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { jstNow } from '@/lib/datetime/jstNow'
import { sendLoginNewDeviceEmail } from '@/lib/email/loginNewDevice'
import { formatBrowserLabel, formatJstDateTimeLabel } from '@/lib/email/templates/loginNewDevice'

export { DEVICE_COOKIE_NAME, DEVICE_ID_RE, deviceCookieOptions, type DeviceCookieOptions } from './deviceCookie'

export function generateDeviceId(): string {
  return randomBytes(32).toString('hex')
}

/** auth_event_logs（src/lib/auth/authEventLog.ts）と同じ長さで切る */
const USER_AGENT_MAX = 256

function clipUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null
  return userAgent.length > USER_AGENT_MAX ? userAgent.slice(0, USER_AGENT_MAX) : userAgent
}

/**
 * デモ・予約用のメールアドレスには通知を送らない（記録＝既知端末判定は通常どおり行う）。
 * 対象: 例示用ドメイン(example.com)・RFC 2606 の予約TLD(.invalid/.test)・デモアカウント(client.com)。
 */
const NON_NOTIFIABLE_EMAIL_PATTERNS = [/@example\.com$/i, /\.invalid$/i, /\.test$/i, /@client\.com$/i]

export function isNotifiableEmail(email: string): boolean {
  return !NON_NOTIFIABLE_EMAIL_PATTERNS.some((re) => re.test(email))
}

export interface RecordDeviceLoginInput {
  userId: string
  deviceId: string
  userAgent: string | null
}

export interface RecordDeviceLoginResult {
  /** 新しい端末と判定したか */
  isNew: boolean
}

/**
 * 端末の既知判定＋記録（同期処理のみ。メール送信はしない）。
 * API route はこの結果（isNew）を見て、レスポンスを返した後に `after()` で notifyNewDevice を呼ぶ想定。
 *
 * 「新規端末かどうか」は upsert 前の select で判定する（実装判断: 同時に2リクエストが並行すると
 * 両方が「新規」と判定し得るが、ログイン直後に同一端末から並行リクエストが飛ぶのは稀で、実害は
 * 「通知メールが1通多い」だけなので許容する。厳密な排他はDBロックが要り過剰）。
 *
 * select 失敗時は「安全側に倒す」のではなく、取りこぼしを選ぶ: DB 不調中のログインは記録も通知も
 * しない。不調のたびに誤った判定で記録・通知を試みるより、静かに失敗して次回の正常なログインで
 * 追いつく方を選んでいる。
 */
export async function recordDeviceLogin(input: RecordDeviceLoginInput): Promise<RecordDeviceLoginResult> {
  const { userId, deviceId, userAgent } = input
  const admin = createAdminClient()

  const { data: existing, error: selectError } = await admin
    .from('user_known_devices')
    .select('user_id')
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .maybeSingle()

  if (selectError) {
    console.error('[login-notify] select failed (取りこぼしを選ぶ・記録しない):', selectError.message)
    return { isNew: false }
  }

  const isNew = !existing

  // last_seen_at は timestamptz 列へ渡す「完全な時刻」なので toISOString() でよい（日付だけの表示に使う値ではない）
  const { error: upsertError } = await admin
    .from('user_known_devices')
    .upsert(
      { user_id: userId, device_id: deviceId, user_agent: clipUserAgent(userAgent), last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,device_id' },
    )
  if (upsertError) {
    console.error('[login-notify] upsert failed:', upsertError.message)
  }

  return { isNew }
}

export interface NotifyNewDeviceInput {
  email: string | null | undefined
  userAgent: string | null
}

/**
 * 新規端末のメール通知（ベストエフォート・例外を投げない）。
 * API route から `after()`（レスポンス送出後）で呼ぶ想定なので、ここで時間がかかってもレイテンシに乗らない。
 */
export async function notifyNewDevice(input: NotifyNewDeviceInput): Promise<void> {
  const { email, userAgent } = input
  if (!email) {
    console.warn('[login-notify] new device but user has no email; skipping notification')
    return
  }
  if (!isNotifiableEmail(email)) return

  try {
    await sendLoginNewDeviceEmail({
      to: email,
      dateTimeLabel: formatJstDateTimeLabel(jstNow()),
      browserLabel: formatBrowserLabel(userAgent),
    })
  } catch (err) {
    console.error('[login-notify] email send failed:', err instanceof Error ? err.message : err)
  }
}

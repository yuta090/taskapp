/**
 * なりすましログイン対策: 新しい端末（ブラウザ）からの初回ログインを検知して本人に通知する。
 *
 * 端末の識別は httpOnly cookie（agentpm_device・ランダム32byte hex）。この cookie の device_id が
 * `user_known_devices` に無ければ「新しい端末」と判定し、本人のメールに通知する。
 * 同じ端末からの2回目以降（cookie が既にあり、行も既にある）は送らない。
 *
 * 呼び出し元は2つ（どちらも同じロジックを使う。設計: パスワードログインの API と Google ログインの
 * callback route で cookie の発行元が違うため、判定・記録・送信の本体だけをここに切り出す）:
 *   - POST /api/auth/login-notify（パスワードログイン後にクライアントから fire-and-forget で呼ぶ）
 *   - src/app/auth/callback/route.ts（Google ログイン後、レスポンスに直接 cookie をセットする）
 *
 * server 専用（service role を使う）。'use client' から import しない。
 */
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { jstNow } from '@/lib/datetime/jstNow'
import { sendLoginNewDeviceEmail } from '@/lib/email/loginNewDevice'
import { formatBrowserLabel, formatJstDateTimeLabel } from '@/lib/email/templates/loginNewDevice'

export const DEVICE_COOKIE_NAME = 'agentpm_device'

/** 400日（Chrome等の cookie 有効期限の実質上限と同じ長さ） */
const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

export function generateDeviceId(): string {
  return randomBytes(32).toString('hex')
}

export interface DeviceCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

/** ローカル開発（http）でも Set-Cookie が効くよう、本番だけ Secure を付ける */
export function deviceCookieOptions(): DeviceCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  }
}

export interface RecordLoginAndNotifyInput {
  userId: string
  /** Supabase User の email。無ければ通知できないので送らない（記録はする） */
  email: string | null | undefined
  deviceId: string
  userAgent: string | null
}

export interface RecordLoginAndNotifyResult {
  /** 新しい端末と判定してメール通知を試みたか（Resend送信そのものの成否ではない） */
  notified: boolean
}

/**
 * 端末の既知判定＋記録＋（新規なら）本人へのメール通知。
 *
 * 「新規端末かどうか」は upsert 前の select で判定する（Fable裁定ではなく実装判断: 同時に2リクエストが
 * 並行すると両方が「新規」と判定し得るが、ログイン直後に同一端末から並行リクエストが飛ぶのは稀で、
 * 実害は「通知メールが1通多い」だけなので許容する。厳密な排他はDBロックが要り過剰）。
 *
 * メール送信の失敗は記録を巻き戻さない・例外も投げない（通知はベストエフォートで、ログイン導線を止めない）。
 */
export async function recordLoginAndNotify(input: RecordLoginAndNotifyInput): Promise<RecordLoginAndNotifyResult> {
  const { userId, email, deviceId, userAgent } = input
  const admin = createAdminClient()

  const { data: existing, error: selectError } = await admin
    .from('user_known_devices')
    .select('user_id')
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .maybeSingle()

  if (selectError) {
    console.error('[login-notify] select failed:', selectError.message)
    // 既知判定ができない → fail safe で「通知しない」（DB不調のたびに送ると迷惑）。記録もスキップする
    return { notified: false }
  }

  const isNew = !existing

  // last_seen_at は timestamptz 列へ渡す「完全な時刻」なので toISOString() でよい（日付だけの表示に使う値ではない）
  const { error: upsertError } = await admin
    .from('user_known_devices')
    .upsert(
      { user_id: userId, device_id: deviceId, user_agent: userAgent, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,device_id' },
    )
  if (upsertError) {
    console.error('[login-notify] upsert failed:', upsertError.message)
  }

  if (!isNew) return { notified: false }
  if (!email) {
    console.warn('[login-notify] new device but user has no email; skipping notification')
    return { notified: false }
  }

  try {
    await sendLoginNewDeviceEmail({
      to: email,
      dateTimeLabel: formatJstDateTimeLabel(jstNow()),
      browserLabel: formatBrowserLabel(userAgent),
    })
  } catch (err) {
    console.error('[login-notify] email send failed:', err instanceof Error ? err.message : err)
  }

  return { notified: true }
}

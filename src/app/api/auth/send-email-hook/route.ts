import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { sendAuthEmail, type AuthEmailHookPayload } from '@/lib/email/sendAuthEmail'

export const runtime = 'nodejs'

/**
 * POST /api/auth/send-email-hook — Supabase Auth「Send Email Hook」の受け口
 *
 * Supabase がサインアップ確認・パスワード再設定・ログイン用リンク・メール変更確認のメールを送る代わりに
 * ここへ POST してくる。当社が管理画面の文面＋当社の差出人で送る。
 *
 * - 署名検証: Standard Webhooks（webhook-id / webhook-timestamp / webhook-signature）。
 *   秘密は env `SEND_EMAIL_HOOK_SECRET`（Supabase ダッシュボードで生成。`v1,whsec_` 付きのまま入れてよい）
 * - 秘密が未設定なら 503 で拒否（Hook を向けたのに env が無い事故を、黙って送らずに見えるようにする）
 * - 2xx 以外を返すと Supabase 側の認証操作がエラーになるので、送信失敗は 500 で正直に返す
 * - 設定手順: docs/ops/AUTH_EMAIL_HOOK.md
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET
  if (!secret) {
    console.error('[send-email-hook] SEND_EMAIL_HOOK_SECRET is not configured')
    return NextResponse.json({ error: { http_code: 503, message: 'hook secret not configured' } }, { status: 503 })
  }

  const payload = await request.text()
  const headers = {
    'webhook-id': request.headers.get('webhook-id') ?? '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
    'webhook-signature': request.headers.get('webhook-signature') ?? '',
  }

  let data: AuthEmailHookPayload
  try {
    const wh = new Webhook(secret.replace(/^v1,whsec_/, ''))
    data = wh.verify(payload, headers) as AuthEmailHookPayload
  } catch (err) {
    console.warn('[send-email-hook] signature verification failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { http_code: 401, message: 'invalid signature' } }, { status: 401 })
  }

  if (!data?.user?.email || !data?.email_data?.email_action_type) {
    return NextResponse.json({ error: { http_code: 400, message: 'invalid payload' } }, { status: 400 })
  }

  try {
    await sendAuthEmail(data)
    return NextResponse.json({})
  } catch (err) {
    console.error('[send-email-hook] send failed:', err)
    return NextResponse.json({ error: { http_code: 500, message: 'email send failed' } }, { status: 500 })
  }
}

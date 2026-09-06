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
 * - 2xx 以外を返すと Supabase 側の認証操作がエラーになる。送信失敗は 500 で正直に返す（方針: 黙って 200 を返して
 *   「メールが来るはず」と待たせるより、その場でエラーが見えて再試行できる方が良い。Resend には 8 秒のタイムアウト）。
 *   戻し手順は Hook を Disable にするだけ（docs/ops/AUTH_EMAIL_HOOK.md）
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

  // 秘密の形式ミス（base64 でない等）は「署名不一致」と区別して 503 にする（誤診防止）
  let wh: Webhook
  try {
    wh = new Webhook(secret.trim().replace(/^v1,whsec_/, ''))
  } catch (err) {
    console.error('[send-email-hook] SEND_EMAIL_HOOK_SECRET の形式が不正です:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { http_code: 503, message: 'hook secret malformed' } }, { status: 503 })
  }

  let data: AuthEmailHookPayload
  try {
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

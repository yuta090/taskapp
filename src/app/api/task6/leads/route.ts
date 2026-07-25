import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTemplateDownloadEmail } from '@/lib/email/templateDownload'
import { sendLeadNotificationEmail } from '@/lib/email/lead'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  getLeadMagnet,
  SIGNED_URL_TTL_SECONDS,
  SIGNED_URL_TTL_HOURS,
  TEMPLATES_BUCKET,
} from '@/lib/task6/leadMagnets'

// TASK6 テンプレ配布（中間CV）のリード受付。未認証で叩ける公開エンドポイント。
// 配布物はメール宛の署名URLでのみ渡す（実在アドレスだけが受け取れる）。
//
// 任意の申告アドレス宛に自ドメインからメールを送る唯一の公開経路なので、
// 送信リレー悪用（他人のアドレスを入れて連投→ドメインの送信評判低下）を
// IP・宛先・全体の三層で絞る。IPはx-forwarded-for依存で偽装可能なため、
// 宛先別・全体の上限が実質の安全弁。
const LEAD_RATE_LIMIT = { maxRequests: 5, windowMs: 10 * 60 * 1000 }
const PER_EMAIL_RATE_LIMIT = { maxRequests: 3, windowMs: 24 * 60 * 60 * 1000 }
const GLOBAL_RATE_LIMIT = { maxRequests: 200, windowMs: 24 * 60 * 60 * 1000 }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LEN = 254
const MAX_SOURCE_PATH_LEN = 200

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`task6-leads:${getClientIp(request)}`, LEAD_RATE_LIMIT)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // honeypot: 人間には見えないwebsite欄が埋まっていたらbot。保存せず成功を装う
  if (typeof body.website === 'string' && body.website.length > 0) {
    return NextResponse.json({ ok: true })
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const templateKey = typeof body.templateKey === 'string' ? body.templateKey : ''
  const newsletterOptIn = body.newsletterOptIn === true
  const rawSourcePath = typeof body.sourcePath === 'string' ? body.sourcePath : ''
  const sourcePath =
    rawSourcePath.startsWith('/') && rawSourcePath.length <= MAX_SOURCE_PATH_LEN
      ? rawSourcePath
      : null

  if (!email || !EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN) {
    return NextResponse.json({ error: 'valid email is required' }, { status: 400 })
  }
  const magnet = getLeadMagnet(templateKey)
  if (!magnet) {
    return NextResponse.json({ error: 'unknown template' }, { status: 400 })
  }

  const perEmail = checkRateLimit(`task6-leads:email:${email}`, PER_EMAIL_RATE_LIMIT)
  if (!perEmail.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const global = checkRateLimit('task6-leads:global', GLOBAL_RATE_LIMIT)
  if (!global.allowed) {
    console.error('[task6-leads] global daily send cap reached')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const admin = createAdminClient()
  const { error: insertError } = await admin.from('template_leads').insert({
    email,
    template_key: magnet.key,
    newsletter_opt_in: newsletterOptIn,
    source_path: sourcePath,
    user_agent: request.headers.get('user-agent'),
    referer: request.headers.get('referer'),
  })
  if (insertError) {
    if (insertError.code === '23505') {
      // 同じメール×同じテンプレの再申込。エラーにせず最終申込日時を更新して再送する
      // （opt-inは true への引き上げのみ。false での上書き=解除は別導線で行う）
      const updatePayload: Record<string, unknown> = {
        // 完全なタイムスタンプ(timestamptz)なのでtoISOString禁止則の対象外
        // （禁止則が警戒するのは日付文字列切り出しによる1日ずれ）
        last_requested_at: new Date().toISOString(),
      }
      if (newsletterOptIn) updatePayload.newsletter_opt_in = true
      const { error: updateError } = await admin
        .from('template_leads')
        .update(updatePayload)
        .eq('email', email)
        .eq('template_key', magnet.key)
      if (updateError) {
        console.error('[task6-leads] re-request update failed:', updateError.message)
      }
    } else {
      console.error('[task6-leads] insert failed:', insertError.message)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
  }

  const { data: signed, error: signError } = await admin.storage
    .from(TEMPLATES_BUCKET)
    .createSignedUrl(magnet.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: magnet.fileName,
    })
  if (signError || !signed?.signedUrl) {
    console.error('[task6-leads] signed url failed:', signError?.message)
    return NextResponse.json({ error: 'Failed to issue download link' }, { status: 500 })
  }

  // 運営者への新規登録通知。失敗してもリードは保存済みなので握りつぶす
  try {
    await sendLeadNotificationEmail({
      source: 'task6-dl',
      email,
      message: `テンプレDL申込: ${magnet.title}${newsletterOptIn ? '（お知らせ希望あり）' : ''}${sourcePath ? `\n流入記事: ${sourcePath}` : ''}`,
    })
  } catch (e) {
    console.error('[task6-leads] operator notification failed:', e)
  }

  // 本人宛の配布メール。失敗時はレスポンスでリンクを直接返すフォールバック
  try {
    await sendTemplateDownloadEmail({
      to: email,
      magnetTitle: magnet.title,
      downloadUrl: signed.signedUrl,
      expiresHours: SIGNED_URL_TTL_HOURS,
    })
  } catch (e) {
    console.error('[task6-leads] download email failed:', e)
    return NextResponse.json({ ok: true, emailSent: false, downloadUrl: signed.signedUrl })
  }

  return NextResponse.json({ ok: true, emailSent: true })
}

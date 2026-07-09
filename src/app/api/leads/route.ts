import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendLeadNotificationEmail } from '@/lib/email/lead'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

// LP(lp1/lp2…静的HTML)と/contactフォームのリード受付。未認証で叩ける公開エンドポイント。
const LEAD_RATE_LIMIT = { maxRequests: 5, windowMs: 10 * 60 * 1000 }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LEN = {
  source: 32,
  email: 254,
  name: 100,
  company: 200,
  message: 2000,
} as const

function tooLong(value: string | undefined, key: keyof typeof MAX_LEN): boolean {
  return typeof value === 'string' && value.length > MAX_LEN[key]
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`leads:${getClientIp(request)}`, LEAD_RATE_LIMIT)
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

  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  const company = typeof body.company === 'string' ? body.company.trim() : undefined
  const message = typeof body.message === 'string' ? body.message.trim() : undefined
  const extra: Record<string, string> = {}
  for (const key of ['teamSize', 'currentTool'] as const) {
    if (typeof body[key] === 'string' && (body[key] as string).length <= 200) {
      extra[key] = body[key] as string
    }
  }

  if (!source || !email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'source and valid email are required' }, { status: 400 })
  }
  if (
    tooLong(source, 'source') ||
    tooLong(email, 'email') ||
    tooLong(name, 'name') ||
    tooLong(company, 'company') ||
    tooLong(message, 'message')
  ) {
    return NextResponse.json({ error: 'Field too long' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('lp_leads').insert({
    source,
    email,
    name: name || null,
    company: company || null,
    message: message || null,
    extra: Object.keys(extra).length > 0 ? extra : null,
    user_agent: request.headers.get('user-agent'),
    referer: request.headers.get('referer'),
  })
  if (error) {
    console.error('[leads] insert failed:', error.message)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  // 通知メールの失敗でリード自体を失わない（保存済みなので200を返す）
  try {
    await sendLeadNotificationEmail({ source, email, name, company, message })
  } catch (e) {
    console.error('[leads] notification email failed:', e)
  }

  return NextResponse.json({ ok: true })
}

import { Resend } from 'resend'
import { buildFrom, getAppName, sanitizeDisplayName, sanitizeReplyTo } from './from'

// 遅延初期化でビルド時エラーを回避
let resendClient: Resend | null = null

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured')
    }
    resendClient = new Resend(apiKey)
  }
  return resendClient
}



function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

import { renderInviteEmail, type InviteTemplateVars } from './templates/invite'
import { resolveEmailTemplate } from './templates/orgEmailTemplate'
import type { TemplateFields } from './templates/core'

export interface SendInviteEmailParams {
  /** 招待元の事務所。渡すとその事務所が保存した文面を使う（無ければ運営/既定） */
  orgId?: string | null
  /** 相手の名前（任意）。宛先の表示名に使う（「山田 太郎 <a@example.com>」） */
  toName?: string | null
  /** その1通かぎりの文面（招待フォームでその場で直したもの。呼び出し側で検証済みのこと） */
  fields?: TemplateFields
  /** 差出人表示名に載せる事務所名（有料プランのときだけ呼び出し側が渡す。本文の組織名とは別） */
  senderOrgName?: string | null
  /** 返信先（操作した担当者のメール）。相手先が返信すると担当者に届く */
  replyTo?: string | null
  to: string
  inviterName: string
  orgName: string
  spaceName: string
  role: 'client' | 'member'
  token: string
  expiresAt: string
  message?: string
}

/**
 * 招待メールを送る。
 * 文面は「その場の差し替え(fields) → 事務所の保存(org_email_templates) →
 * 運営の保存(email_templates) → コード既定(templates/invite.ts)」の順で決まる。
 * HTML の枠と差し込みは renderInviteEmail に集約。
 */
export async function sendInviteEmail(params: SendInviteEmailParams) {
  const { to, inviterName, orgName, spaceName, role, token, expiresAt, message, replyTo, senderOrgName } = params

  const appUrl = getAppUrl()
  const appName = getAppName()

  // クライアントと内部メンバーで異なるURLとテンプレート
  const isClient = role === 'client'
  const inviteUrl = isClient
    ? `${appUrl}/portal/${token}`
    : `${appUrl}/invite/${token}`

  const expiresDate = new Date(expiresAt).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const vars: InviteTemplateVars = { inviterName, orgName, spaceName, expiresDate, appName }
  const templateKey = isClient ? 'invite_client' : 'invite_member'
  const fields = params.fields ?? (await resolveEmailTemplate(params.orgId ?? null, templateKey)).fields
  const { subject, html, text } = renderInviteEmail({
    variant: isClient ? 'client' : 'member',
    fields,
    vars,
    inviteUrl,
    message,
  })

  const safeName = params.toName ? sanitizeDisplayName(params.toName) : ''
  const toDisplay = safeName ? `"${safeName}" <${to}>` : to

  try {
    const resend = getResendClient()
    const { data, error } = await resend.emails.send({
      // 相手先には「{事務所名} (AgentPM)」の名前で届き、返信は操作した担当者へ
      from: buildFrom({ orgName: senderOrgName }),
      replyTo: sanitizeReplyTo(replyTo),
      // 名前が分かっていれば宛先に表示名を付ける（受信箱で誰宛てか分かる）
      to: toDisplay,
      subject,
      html,
      text,
    })

    if (error) {
      console.error('Failed to send invite email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}

/**
 * 招待の種類（社内 = member / 相手先 = client・vendor）と、その人の組織の役割の整合を DB が断ったときの
 * 符号を、画面に出す日本語にする（20260912151932_invite_role_consistency.sql）。
 *
 *   IRC01 invite_org_role_conflict           … すでにその組織に別の種類で参加している人への招待
 *                                              （DETAIL に org_role=… invite_role=… が入る）
 *   IRC02 invite_pending_kind_conflict       … 同じメールアドレスに、種類の違う承諾待ちの招待がある
 *   IRC03 invite_vendor_requires_agency_mode … 協力会社（vendor）の招待は、代理店モードのプロジェクトだけ
 *
 * この3つ以外なら null を返す（呼び出し側は今までどおりに扱う）。DB の英語の文言は画面に出さない。
 */
export type InviteRoleConflictSource =
  | { code?: string | null; message?: string | null; details?: string | null }
  | null
  | undefined

/** 招待を「作る」ときと「送り直す」ときで、次にできることが違うので文言を分ける */
export type InviteRoleConflictAction = 'create' | 'resend'

const ORG_ROLE_IN_DETAIL = /org_role=([a-z_]+)/

export function inviteRoleConflictMessage(
  error: InviteRoleConflictSource,
  action: InviteRoleConflictAction = 'create'
): string | null {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  const hit = (sqlstate: string, key: string) => code === sqlstate || message.includes(key)

  if (hit('IRC01', 'invite_org_role_conflict')) {
    const orgRole = ORG_ROLE_IN_DETAIL.exec(error?.details ?? '')?.[1]
    const already = orgRole === 'client' ? '相手先' : orgRole ? '社内メンバー' : 'この組織の別の種類のメンバー'
    return action === 'resend'
      ? `この宛先の人はすでに${already}として参加しているため、この招待は送り直せません。招待を取り消してください。`
      : `この人はすでに${already}として参加しているため、この種類では招待できません`
  }

  if (hit('IRC02', 'invite_pending_kind_conflict')) {
    return '同じメールアドレスに、種類の違う承諾待ちの招待があります。先にその招待を取り消してください。'
  }

  if (hit('IRC03', 'invite_vendor_requires_agency_mode')) {
    return action === 'resend'
      ? '協力会社の招待を送り直せるのは、代理店モードのプロジェクトだけです'
      : '協力会社として招待できるのは、代理店モードのプロジェクトだけです'
  }

  return null
}

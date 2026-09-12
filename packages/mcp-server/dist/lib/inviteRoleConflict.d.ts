/**
 * 招待の種類（社内 = member / 相手先 = client・vendor）と、その人の組織の役割の整合を DB が断ったときの
 * 符号を、道具の呼び手（CLI / AI）に見せる日本語にする（20260912151932_invite_role_consistency.sql）。
 * 画面側の src/lib/invites/roleConflictMessage.ts と同じ文言（道具は別パッケージなので写し。片方を直したら両方）。
 *
 *   IRC01 invite_org_role_conflict           … すでにその組織に別の種類で参加している人への招待
 *   IRC02 invite_pending_kind_conflict       … 同じメールアドレスに、種類の違う承諾待ちの招待がある
 *   IRC03 invite_vendor_requires_agency_mode … 協力会社（vendor）の招待は、代理店モードのプロジェクトだけ
 *
 * この3つ以外なら null（呼び出し側は今までどおり扱う。DB の英語の文言は呼び手に返さない）。
 */
export type InviteRoleConflictSource = {
    code?: string | null;
    message?: string | null;
    details?: string | null;
} | null | undefined;
export type InviteRoleConflictAction = 'create' | 'resend';
export declare function inviteRoleConflictMessage(error: InviteRoleConflictSource, action?: InviteRoleConflictAction): string | null;
//# sourceMappingURL=inviteRoleConflict.d.ts.map
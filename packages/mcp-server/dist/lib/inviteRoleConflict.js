const ORG_ROLE_IN_DETAIL = /org_role=([a-z_]+)/;
export function inviteRoleConflictMessage(error, action = 'create') {
    const code = error?.code ?? '';
    const message = error?.message ?? '';
    const hit = (sqlstate, key) => code === sqlstate || message.includes(key);
    if (hit('IRC01', 'invite_org_role_conflict')) {
        const orgRole = ORG_ROLE_IN_DETAIL.exec(error?.details ?? '')?.[1];
        const already = orgRole === 'client' ? '相手先' : orgRole ? '社内メンバー' : 'この組織の別の種類のメンバー';
        return action === 'resend'
            ? `この宛先の人はすでに${already}として参加しているため、この招待は送り直せません。招待を取り消してください。`
            : `この人はすでに${already}として参加しているため、この種類では招待できません`;
    }
    if (hit('IRC02', 'invite_pending_kind_conflict')) {
        return '同じメールアドレスに、種類の違う承諾待ちの招待があります。先にその招待を取り消してください。';
    }
    if (hit('IRC03', 'invite_vendor_requires_agency_mode')) {
        return action === 'resend'
            ? '協力会社の招待を送り直せるのは、代理店モードのプロジェクトだけです'
            : '協力会社として招待できるのは、代理店モードのプロジェクトだけです';
    }
    return null;
}
//# sourceMappingURL=inviteRoleConflict.js.map
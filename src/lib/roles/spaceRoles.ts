/**
 * プロジェクト（スペース）の役割と、その人にできること。
 *
 * 画面のヒント（設定 > メンバーの「?」）と使い方マニュアル（/help）で同じ文を使うため、
 * ここを唯一の正本にする。役割の権限を変えたら必ずこの説明も直すこと。
 */
export interface SpaceRoleGuide {
  /** space_memberships.role の値 */
  value: 'admin' | 'editor' | 'viewer' | 'client' | 'vendor'
  label: string
  desc: string
}

export const SPACE_ROLE_GUIDE: SpaceRoleGuide[] = [
  {
    value: 'admin',
    label: '管理者',
    desc: 'プロジェクトの設定をすべて変更できます。メンバーの招待・役割の変更・削除、プロジェクトのアーカイブもできます。',
  },
  {
    value: 'editor',
    label: '編集者',
    desc: 'タスクの作成・編集・ボールの受け渡しができます。メンバーの招待もできます（役割の変更と削除は管理者のみ）。',
  },
  {
    value: 'viewer',
    label: '閲覧者',
    desc: 'タスクの閲覧とコメントのみ。タスクの編集はできません。',
  },
  {
    value: 'client',
    label: 'クライアント',
    desc: '相手先の担当者。クライアントポータルから、公開されたタスクの確認・承認・修正依頼を行います。',
  },
  {
    value: 'vendor',
    label: 'ベンダー',
    desc: '制作会社。ベンダーポータルから進捗報告・見積もり提出を行います（代理店モードのときだけ使います）。',
  },
]

export const SPACE_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SPACE_ROLE_GUIDE.map((r) => [r.value, r.label])
)

/**
 * 招待時に選べる役割。invites.role の制約（client | member）に合わせている。
 * 受諾時の変換は rpc_accept_invite が持つ: member → editor / client → client。
 */
export const INVITE_ROLE_GUIDE = [
  {
    value: 'member',
    label: 'メンバー',
    desc: '社内の人。参加すると「編集者」になります（あとから管理者が役割を変えられます）。',
  },
  {
    value: 'client',
    label: 'クライアント',
    desc: '相手先の人。クライアントポータルだけが見られます。',
  },
] as const

/**
 * 招待の役割（client | member）の表示名。
 * 参加したあとの役割（SPACE_ROLE_LABELS: 管理者・編集者…）とは別の言葉なので混ぜない。
 * 混ぜると、まだ参加していない人の 'member' が英語のまま画面に出る。
 */
export const INVITE_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  INVITE_ROLE_GUIDE.map((r) => [r.value, r.label])
)

/** プロジェクトの管理者か（owner は組織側の役割だが、念のため管理者扱いにする） */
export function isSpaceAdminRole(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'owner'
}

/** メンバーを招待できるか。サーバー側（/api/invites・rpc_create_invite）と同じ条件。 */
export function canInviteMembers(role: string | undefined | null): boolean {
  return isSpaceAdminRole(role) || role === 'editor'
}

/**
 * 社内メンバーの役割か（admin / editor / viewer）。相手先（client / vendor）や不明な役割は false。
 * 通す役割を並べる形にして、役割が取れなかったとき・新しい役割が増えたときは「社外」側に倒す。
 * API キーは社内メンバー専用（利用の拒否の正本は DB の mcp_authorize。発行側でもこの判定で二重に守る）。
 */
export const INTERNAL_SPACE_ROLES = ['admin', 'editor', 'viewer'] as const

export function isInternalSpaceRole(role: string | undefined | null): boolean {
  return (INTERNAL_SPACE_ROLES as readonly string[]).includes(role ?? '')
}

/**
 * 組織（org_memberships.role）の役割が「社内」か。owner / admin / member のみ。
 * client（相手先・vendor も org 側は 'client'）や、まだ取れていない役割は false（社外側に倒す）。
 * DB 側の判定（app_is_org_internal, 20260703_*_rls_helpers.sql）と同じ規則。
 */
const ORG_INTERNAL_ROLES = ['owner', 'admin', 'member'] as const

export function isOrgInternalRole(role: string | undefined | null): boolean {
  return (ORG_INTERNAL_ROLES as readonly string[]).includes(role ?? '')
}

const EDITABLE_SPACE_ROLES = ['admin', 'editor'] as const

/**
 * この space の内容（タスク・ガント・Wiki・見積など）を編集できるか。
 * DB 側の判定（app_can_write_space, 20260911143112_space_role_boundary.sql）と同じ規則:
 * 組織の役割が社内（owner/admin/member）で、かつ space の役割が admin/editor か、
 * space_memberships に行が無い（社内メンバーは editor 扱い）人だけ編集できる。
 * 閲覧者（viewer）・相手先（client）・vendor、および組織側が社外の人はできない。
 *
 * 画面はこの判定だけを唯一の正本にし、直接 role 文字列を比較しないこと（DB の規則が
 * 変わったらここだけ直せばよい状態を保つ）。
 */
export function canEditSpaceContent(
  spaceRole: string | undefined | null,
  orgRole: string | undefined | null
): boolean {
  if (!isOrgInternalRole(orgRole)) return false
  return spaceRole == null || (EDITABLE_SPACE_ROLES as readonly string[]).includes(spaceRole)
}

/**
 * 価格の枠（TaskPricingPanel）・代理店設定（AgencySettings）を操作できるか。
 * DB 側の判定（guard_agency_settings, 20260308_002_agency_settings_write_guard.sql /
 * guard_task_pricing_write・guard_task_pricing_delete, 20260308_003_task_pricing_write_guard.sql）
 * と同じ規則: space_memberships の行がはっきり admin/editor の人だけ。
 *
 * canEditSpaceContent と違い、
 * - space_memberships に行が無い社内メンバーへの「editor 扱い」フォールバックは無い
 *   （トリガーは space_memberships を直接引き、行が無ければ caller_role が NULL のまま弾く）
 * - 組織の役割（org_memberships）は見ない（トリガー自体が見ていない）
 */
export function canEditSpaceMoney(spaceRole: string | undefined | null): boolean {
  return (EDITABLE_SPACE_ROLES as readonly string[]).includes(spaceRole ?? '')
}

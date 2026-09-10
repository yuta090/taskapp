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

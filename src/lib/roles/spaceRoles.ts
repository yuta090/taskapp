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
 * 「space_memberships の行がはっきり admin/editor の人だけ」という、より狭い規則を課す
 * DB の門番で守られた操作を行えるか。canEditSpaceContent と違い、行が無い社内メンバーへの
 * 「editor 扱い」フォールバックは無い（これらの門番はどれも space_memberships を直接引き、
 * 行が無ければ弾く）。今のところ使う場面（=同じ規則を課す DB の門番）:
 * - 価格の枠（TaskPricingPanel） … トリガー guard_task_pricing_write・guard_task_pricing_delete
 *   （20260308_003_task_pricing_write_guard.sql）＋自身の RLS（task_pricing_*_member,
 *   20260703_011_rls_task_pricing_internal_only.sql の app_is_org_internal・組織の役割も要る）
 * - 代理店設定（AgencySettings） … トリガー guard_agency_settings
 *   （20260308_002_agency_settings_write_guard.sql）。実体は spaces の列なので、書き込みは
 *   RLS（app_can_write_space 経由）の「組織の役割が社内」も同時に満たす必要がある
 * - ポータル表示設定（PortalSettings, spaces.portal_visible_sections） … トリガー
 *   guard_portal_visible_sections（20260307_001_portal_sections_write_guard.sql）。agency設定と同じ形
 * - テンプレート適用（PresetSettings・WikiPageClient の空Wiki CTA, rpc_apply_preset_to_space） …
 *   RPC 内の確認（20260911143112_space_role_boundary.sql）が app_can_write_space の前に
 *   space_memberships の行を直接確認する
 * - Slackチャンネルの連携・解除・自動通知（SlackChannelSettings） … RLS ポリシー
 *   "space admins can manage slack channels"（20250213_000_slack_integration.sql）
 *
 * 名前は canEditSpaceMoney のままだが、上記のとおり価格・代理店設定に限らず同じ規則の
 * 門番全般に使う（他の作業が同時に AgencySettings・TaskInspector を触っているため、
 * より汎用的な名前への変更は今回は見送り、後でまとめて行う）。
 */
export function canEditSpaceMoney(
  spaceRole: string | undefined | null,
  orgRole: string | undefined | null
): boolean {
  if (!isOrgInternalRole(orgRole)) return false
  return (EDITABLE_SPACE_ROLES as readonly string[]).includes(spaceRole ?? '')
}

/**
 * 社内承認（レビュー）の承認者候補になれる役割か（space の admin / editor だけ）。
 * DB 側の判定（rpc_review_open, 20260911180601_review_request_notify.sql の
 * 「社内承認のレビュアーは社内ロール（admin / editor）のみ」）と同じ規則。
 * 閲覧者（viewer）を選んで依頼すると DB 側で断られるため、画面の選択肢にも出さない。
 */
export function isReviewApproverRole(role: string | undefined | null): boolean {
  return (EDITABLE_SPACE_ROLES as readonly string[]).includes(role ?? '')
}

const INTERNAL_ORG_SPACE_ROLES: SpaceRoleGuide['value'][] = ['admin', 'editor', 'viewer']

/**
 * 組織の役割（と代理店モード）から、その人が space で選べる役割を返す
 * （Fable裁定 role-consistency-decision, 2026-09-12）。DB側でもトリガー・RPCの両方で
 * 同じ規則で断る（RC-1）。ここは画面用の正本。
 *
 * - 組織が社内（owner/member。'admin' は死に値だが同じ扱い）→ 管理者/編集者/閲覧者 だけ
 * - 組織が client（相手先）→ クライアント だけ。代理店モード(spaces.agency_mode)が
 *   真のときだけ ベンダー も選べる（社内メンバーに vendor/client は禁止・降格として使わない）
 * - 組織の役割が未取得・不明なら空配列（安全側に倒す。呼び出し側は「変更不可」として扱うこと）
 */
export function allowedSpaceRolesFor(
  orgRole: string | undefined | null,
  agencyMode: boolean
): SpaceRoleGuide['value'][] {
  if (isOrgInternalRole(orgRole)) {
    return [...INTERNAL_ORG_SPACE_ROLES]
  }
  if (orgRole === 'client') {
    return agencyMode ? ['client', 'vendor'] : ['client']
  }
  return []
}

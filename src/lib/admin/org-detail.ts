/**
 * 運営用「組織の詳細」(/admin/organizations/[id]) の表示モデル。
 *
 * DB から取った生の行（メンバー・スペース・課金・共通LINE・チャットグループ・ツール連携・
 * 招待・通知）を、運営が読める日本語ラベル付きの1つのオブジェクトにまとめる純粋関数。
 * データ取得は page.tsx 側、ここは組み立てだけ（テストしやすくするため）。
 *
 * 表示名は UI の言葉に合わせる: 「顧問先」ではなく「相手先」、「共有Bot」ではなく「共通LINE」。
 */
import { PLAN_LABELS } from '@/lib/billing/featureCatalog'
import type { PlanId } from '@/lib/billing/entitlements'
import { getNotificationTypeLabel, getNotificationChannelLabel } from '@/lib/notifications/labels'

// ---------------------------------------------------------------------------
// ラベル
// ---------------------------------------------------------------------------

export const ORG_ROLE_LABEL: Readonly<Record<string, string>> = {
  owner: 'オーナー',
  member: 'メンバー',
  client: '相手先',
}

export function getOrgRoleLabel(role: string): string {
  return ORG_ROLE_LABEL[role] ?? role
}

export const BILLING_STATUS_LABEL: Readonly<Record<string, string>> = {
  active: '有効',
  trialing: 'お試し中',
  past_due: '支払い遅延',
  canceled: '解約済み',
}

/** 課金行が無い（status 空）ときは「未設定」 */
export function getBillingStatusLabel(status: string): string {
  if (!status) return '未設定'
  return BILLING_STATUS_LABEL[status] ?? status
}

export const SHARED_BOT_ACCESS_LABEL: Readonly<Record<string, string>> = {
  none: '未申込',
  requested: '申込中（開通待ち）',
  granted: '開通済み',
}

export function getSharedBotAccessLabel(status: string): string {
  return SHARED_BOT_ACCESS_LABEL[status] ?? status
}

export const INTEGRATION_PROVIDER_LABEL: Readonly<Record<string, string>> = {
  google_calendar: 'Google カレンダー',
  zoom: 'Zoom',
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
  notion: 'Notion',
  google_sheets: 'Google スプレッドシート',
  google_tasks: 'Google Tasks',
  multica: 'multica',
}

export function getIntegrationProviderLabel(provider: string): string {
  return INTEGRATION_PROVIDER_LABEL[provider] ?? provider
}

export const INTEGRATION_STATUS_LABEL: Readonly<Record<string, string>> = {
  active: '接続中',
  expired: '期限切れ',
  revoked: '解除済み',
}

export function getIntegrationStatusLabel(status: string): string {
  return INTEGRATION_STATUS_LABEL[status] ?? status
}

const OWNER_TYPE_LABEL: Readonly<Record<string, string>> = { org: '組織', user: '個人' }
const CHANNEL_GROUP_STATUS_LABEL: Readonly<Record<string, string>> = { active: '参加中', left: '退出済み' }
const SPACE_TYPE_LABEL: Readonly<Record<string, string>> = { project: 'プロジェクト', personal: '個人' }

/** 並び順: オーナー → メンバー → 相手先 → その他 */
const ROLE_ORDER: Readonly<Record<string, number>> = { owner: 0, member: 1, client: 2 }

function planLabel(planId: string): string {
  return (PLAN_LABELS as Record<string, string>)[planId as PlanId] ?? planId
}

// ---------------------------------------------------------------------------
// 入力（DB の生の行）
// ---------------------------------------------------------------------------

export interface OrgDetailInput {
  org: { id: string; name: string; created_at: string }
  memberships: Array<{ user_id: string; role: string; created_at: string }>
  profiles: Array<{ id: string; display_name: string | null; is_superadmin: boolean | null }>
  /** auth 側から引いたメール（user_id → email）。取れなかったユーザーは無くてよい */
  emails: Map<string, string>
  spaces: Array<{ id: string; name: string; type: string; archived_at: string | null; created_at: string }>
  /** タスクは行を運ばず件数だけ（合計・未完了・スペース別）。count クエリで取る */
  taskCounts: { total: number; open: number; bySpace: Record<string, number> }
  spaceMemberships: Array<{ space_id: string }>
  billing: {
    plan_id: string
    status: string
    current_period_end: string | null
    cancel_at_period_end: boolean
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
  } | null
  policy: {
    shared_bot_access: string
    shared_bot_access_requested_at: string | null
    shared_bot_access_granted_at: string | null
    state: string
  } | null
  channelGroups: Array<{
    id: string
    channel: string
    space_id: string | null
    display_name: string | null
    external_group_id: string
    status: string
    joined_at: string
  }>
  integrations: Array<{
    id: string
    provider: string
    owner_type: string
    status: string
    import_enabled: boolean | null
    created_at: string
  }>
  invites: Array<{
    id: string
    email: string
    role: string
    space_id: string
    expires_at: string
    accepted_at: string | null
  }>
  notifications: Array<{ id: string; type: string; channel: string; created_at: string; read_at: string | null }>
  apiKeyCount: number
  /** 「期限内の招待」判定の基準時刻。テストから固定できるように引数にする */
  nowMs: number
}

// ---------------------------------------------------------------------------
// 出力（画面が使う形）
// ---------------------------------------------------------------------------

export interface OrgDetailMember {
  userId: string
  displayName: string | null
  email: string
  role: string
  roleLabel: string
  isSuperadmin: boolean
  joinedAt: string
}

export interface OrgDetailSpace {
  id: string
  name: string
  type: string
  typeLabel: string
  isArchived: boolean
  memberCount: number
  taskCount: number
  createdAt: string
}

export interface OrgDetail {
  id: string
  name: string
  createdAt: string
  billing: {
    planId: string
    planLabel: string
    status: string
    statusLabel: string
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
  }
  stats: {
    memberCount: number
    activeSpaceCount: number
    archivedSpaceCount: number
    taskCount: number
    openTaskCount: number
    channelGroupCount: number
    integrationCount: number
    apiKeyCount: number
    pendingInviteCount: number
  }
  members: OrgDetailMember[]
  spaces: OrgDetailSpace[]
  sharedBot: {
    status: string
    label: string
    requestedAt: string | null
    grantedAt: string | null
    quotaState: string
  }
  channelGroups: Array<{
    id: string
    channel: string
    channelLabel: string
    displayName: string
    spaceId: string | null
    spaceName: string | null
    status: string
    statusLabel: string
    joinedAt: string
  }>
  integrations: Array<{
    id: string
    provider: string
    providerLabel: string
    ownerType: string
    ownerTypeLabel: string
    status: string
    statusLabel: string
    importEnabled: boolean
    createdAt: string
  }>
  pendingInvites: Array<{
    id: string
    email: string
    role: string
    roleLabel: string
    spaceName: string | null
    expiresAt: string
  }>
  recentNotifications: Array<{
    id: string
    type: string
    typeLabel: string
    channel: string
    channelLabel: string
    createdAt: string
    isUnread: boolean
  }>
}

export function buildOrgDetail(input: OrgDetailInput): OrgDetail {
  const profileById = new Map(input.profiles.map((p) => [p.id, p]))
  const spaceNameById = new Map(input.spaces.map((s) => [s.id, s.name]))

  const members: OrgDetailMember[] = input.memberships
    .map((m) => {
      const profile = profileById.get(m.user_id)
      return {
        userId: m.user_id,
        displayName: profile?.display_name ?? null,
        email: input.emails.get(m.user_id) ?? '',
        role: m.role,
        roleLabel: getOrgRoleLabel(m.role),
        isSuperadmin: profile?.is_superadmin === true,
        joinedAt: m.created_at,
      }
    })
    .sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 9
      const rb = ROLE_ORDER[b.role] ?? 9
      if (ra !== rb) return ra - rb
      return a.joinedAt.localeCompare(b.joinedAt)
    })

  const memberCountBySpace = new Map<string, number>()
  for (const sm of input.spaceMemberships) {
    memberCountBySpace.set(sm.space_id, (memberCountBySpace.get(sm.space_id) ?? 0) + 1)
  }

  const spaces: OrgDetailSpace[] = input.spaces
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      typeLabel: SPACE_TYPE_LABEL[s.type] ?? s.type,
      isArchived: s.archived_at != null,
      memberCount: memberCountBySpace.get(s.id) ?? 0,
      taskCount: input.taskCounts.bySpace[s.id] ?? 0,
      createdAt: s.created_at,
    }))
    .sort((a, b) => {
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1
      return a.createdAt.localeCompare(b.createdAt)
    })

  const billingRow = input.billing
  const billing: OrgDetail['billing'] = {
    planId: billingRow?.plan_id ?? 'free',
    planLabel: planLabel(billingRow?.plan_id ?? 'free'),
    status: billingRow?.status ?? '',
    statusLabel: getBillingStatusLabel(billingRow?.status ?? ''),
    currentPeriodEnd: billingRow?.current_period_end ?? null,
    cancelAtPeriodEnd: billingRow?.cancel_at_period_end ?? false,
    stripeCustomerId: billingRow?.stripe_customer_id ?? null,
    stripeSubscriptionId: billingRow?.stripe_subscription_id ?? null,
  }

  const sharedBotStatus = input.policy?.shared_bot_access ?? 'none'
  const sharedBot: OrgDetail['sharedBot'] = {
    status: sharedBotStatus,
    label: getSharedBotAccessLabel(sharedBotStatus),
    requestedAt: input.policy?.shared_bot_access_requested_at ?? null,
    grantedAt: input.policy?.shared_bot_access_granted_at ?? null,
    quotaState: input.policy?.state ?? 'ok',
  }

  const channelGroups: OrgDetail['channelGroups'] = input.channelGroups.map((g) => ({
    id: g.id,
    channel: g.channel,
    channelLabel: getNotificationChannelLabel(g.channel),
    displayName: g.display_name || g.external_group_id,
    spaceId: g.space_id,
    spaceName: g.space_id ? (spaceNameById.get(g.space_id) ?? null) : null,
    status: g.status,
    statusLabel: CHANNEL_GROUP_STATUS_LABEL[g.status] ?? g.status,
    joinedAt: g.joined_at,
  }))

  const integrations: OrgDetail['integrations'] = input.integrations.map((i) => ({
    id: i.id,
    provider: i.provider,
    providerLabel: getIntegrationProviderLabel(i.provider),
    ownerType: i.owner_type,
    ownerTypeLabel: OWNER_TYPE_LABEL[i.owner_type] ?? i.owner_type,
    status: i.status,
    statusLabel: getIntegrationStatusLabel(i.status),
    importEnabled: i.import_enabled === true,
    createdAt: i.created_at,
  }))

  const pendingInvites: OrgDetail['pendingInvites'] = input.invites
    .filter((inv) => inv.accepted_at == null && new Date(inv.expires_at).getTime() > input.nowMs)
    .map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      roleLabel: getOrgRoleLabel(inv.role),
      spaceName: spaceNameById.get(inv.space_id) ?? null,
      expiresAt: inv.expires_at,
    }))

  const recentNotifications: OrgDetail['recentNotifications'] = input.notifications.map((n) => ({
    id: n.id,
    type: n.type,
    typeLabel: getNotificationTypeLabel(n.type),
    channel: n.channel,
    channelLabel: getNotificationChannelLabel(n.channel),
    createdAt: n.created_at,
    isUnread: n.read_at == null,
  }))

  return {
    id: input.org.id,
    name: input.org.name,
    createdAt: input.org.created_at,
    billing,
    stats: {
      memberCount: members.length,
      activeSpaceCount: spaces.filter((s) => !s.isArchived).length,
      archivedSpaceCount: spaces.filter((s) => s.isArchived).length,
      taskCount: input.taskCounts.total,
      openTaskCount: input.taskCounts.open,
      channelGroupCount: channelGroups.filter((g) => g.status === 'active').length,
      integrationCount: integrations.filter((i) => i.status === 'active').length,
      apiKeyCount: input.apiKeyCount,
      pendingInviteCount: pendingInvites.length,
    },
    members,
    spaces,
    sharedBot,
    channelGroups,
    integrations,
    pendingInvites,
    recentNotifications,
  }
}

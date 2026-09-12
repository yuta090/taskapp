import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config } from '../config.js'
import { checkAuth, checkAuthOrg } from '../auth/helpers.js'
import { assertUsersInSpaceOrg } from '../auth/scope.js'
import { ToolUserError } from '../errors.js'
import crypto from 'crypto'

/** 招待・space_memberships の組織は、鍵の組織(config.orgId)ではなく space から取る */
async function getOrgId(spaceId: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  if (error || !data) throw new Error('スペースが見つかりません')
  return (data as { org_id: string }).org_id
}

// Types
export interface ClientInvite {
  id: string
  org_id: string
  space_id: string
  email: string
  role: 'client' | 'member'
  token: string
  expires_at: string
  accepted_at: string | null
  created_by: string
  created_at: string
}

export interface OrgMembership {
  id: string
  org_id: string
  user_id: string
  role: 'owner' | 'member' | 'client'
  created_at: string
}

export interface SpaceMembership {
  id: string
  space_id: string
  user_id: string
  role: 'admin' | 'editor' | 'viewer' | 'client'
  created_at: string
}

// Schemas
export const clientInviteCreateSchema = z.object({
  email: z.string().email().describe('招待する人のメールアドレス'),
  spaceId: z.string().uuid().describe('招待先のスペース（プロジェクト）UUID'),
  role: z
    .enum(['client', 'member'])
    .default('client')
    .describe("役割。client=相手先（ポータル）／member=社内メンバー（アプリ本体）"),
  expiresInDays: z.number().min(1).max(30).default(7).describe('招待の有効期限（日数、デフォルト7日）'),
})

export const clientInviteBulkCreateSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50).describe('クライアントのメールアドレス一覧（最大50件）'),
  spaceId: z.string().uuid().describe('招待先のスペース（プロジェクト）UUID'),
  expiresInDays: z.number().min(1).max(30).default(7).describe('招待の有効期限（日数、デフォルト7日）'),
})

export const clientListSchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUIDでフィルタ（指定しない場合は組織全体）'),
  includeInvites: z.boolean().default(true).describe('未承諾の招待も含める'),
})

export const clientGetSchema = z.object({
  userId: z.string().uuid().describe('クライアントのユーザーUUID'),
})

export const clientUpdateSchema = z.object({
  userId: z.string().uuid().describe('クライアントのユーザーUUID'),
  spaceId: z.string().uuid().describe('スペースUUID'),
  role: z.enum(['client', 'viewer']).describe('新しいロール'),
})

export const clientAddToSpaceSchema = z.object({
  userId: z.string().uuid().describe('クライアントのユーザーUUID'),
  spaceId: z.string().uuid().describe('追加先のスペースUUID'),
  role: z.enum(['client', 'viewer']).default('client').describe('スペースでのロール'),
})

export const clientInviteListSchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUIDでフィルタ'),
  status: z.enum(['pending', 'accepted', 'expired', 'all']).default('pending').describe('招待のステータス'),
  role: z
    .enum(['client', 'member', 'all'])
    .default('client')
    .describe('役割で絞る。client=相手先／member=社内メンバー／all=両方'),
})

export const clientInviteResendSchema = z.object({
  inviteId: z.string().uuid().describe('招待UUID'),
  expiresInDays: z.number().min(1).max(30).default(7).describe('新しい有効期限（日数）'),
})

// Helper function to generate secure token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Tool implementations
export interface ClientInviteWithUrl extends ClientInvite {
  /** そのまま相手に渡せる招待リンク */
  inviteUrl: string
  /** 既存の有効な招待を使い回したか（期限だけ延ばした） */
  reused: boolean
  /** この経路ではメールを送らない（常に false）。送信はアプリ側の再送から */
  emailSent: false
  message: string
}

export async function clientInviteCreate(
  params: z.infer<typeof clientInviteCreateSchema>
): Promise<ClientInviteWithUrl> {
  await checkAuth(params.spaceId, 'write', 'client_invite_create', 'invite')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)
  const actorId = config.actorId

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + params.expiresInDays)
  const email = params.email.toLowerCase()

  // 既に有効な招待（未承諾・未失効）があれば作り直さず期限だけ延ばす。
  // 画面側の rpc_create_invite と同じ約束（同じ宛先に複数のリンクを配らない）。
  // 使い回しは、同じ space・同じ role の招待に限る
  const { data: existing } = await supabase
    .from('invites')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .eq('role', params.role)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (existing) {
    const { data: extended, error: extendError } = await supabase
      .from('invites')
      .update({ expires_at: expiresAt.toISOString() })
      .eq('id', (existing as ClientInvite).id)
      .select('*')
      .single()
    if (extendError) throw new Error('招待の期限延長に失敗しました: ' + extendError.message)
    return withInviteUrl(extended as ClientInvite, true)
  }

  const token = generateToken()

  const { data, error } = await supabase
    .from('invites')
    .insert({
      org_id: orgId,
      space_id: params.spaceId,
      email,
      role: params.role,
      token,
      expires_at: expiresAt.toISOString(),
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw new Error('招待の作成に失敗しました: ' + error.message)
  return withInviteUrl(data as ClientInvite, false)
}

/**
 * 招待リンクを添えて返す。CLI/MCP 経由の招待は**メールを送らない**（送信はアプリ側の経路が持つ）ため、
 * 受け取った人がそのまま相手に渡せるリンクが要る。画面の「保留中の招待 → 再送」でも同じリンクが送られる。
 * 役割ごとに入口が違う: 社内メンバーは /invite/<token>、相手先はポータル /portal/<token>。
 */
function withInviteUrl(invite: ClientInvite, reused: boolean): ClientInviteWithUrl {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://agentpm.app').replace(/\/$/, '')
  const path = invite.role === 'client' ? 'portal' : 'invite'
  return {
    ...invite,
    inviteUrl: `${base}/${path}/${invite.token}`,
    reused,
    emailSent: false,
    message: reused
      ? '同じ宛先に有効な招待があったので、期限を延ばして同じリンクを返しました（メールは送っていません）'
      : '招待を作成しました。メールは送っていないので、リンクを渡すか、設定→メンバーの「保留中の招待」から再送してください',
  }
}

export async function clientInviteBulkCreate(
  params: z.infer<typeof clientInviteBulkCreateSchema>
): Promise<{ created: number; failed: string[]; invites: ClientInvite[] }> {
  await checkAuth(params.spaceId, 'bulk', 'client_invite_bulk_create', 'invite')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)
  const actorId = config.actorId

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + params.expiresInDays)

  const inviteRecords = params.emails.map((email) => ({
    org_id: orgId,
    space_id: params.spaceId,
    email: email.toLowerCase(),
    role: 'client' as const,
    token: generateToken(),
    expires_at: expiresAt.toISOString(),
    created_by: actorId,
  }))

  const { data, error } = await supabase
    .from('invites')
    .insert(inviteRecords)
    .select('*')

  if (error) throw new Error('一括招待の作成に失敗しました: ' + error.message)

  return {
    created: data?.length || 0,
    failed: [],
    invites: (data || []) as ClientInvite[],
  }
}

export async function clientList(
  params: z.infer<typeof clientListSchema>
): Promise<{ members: OrgMembership[]; pendingInvites: ClientInvite[] }> {
  const { ctx } = await checkAuthOrg('read', 'client_list')
  const supabase = getSupabaseClient()
  const orgId = ctx.orgId

  // Get org members with role='client'
  const membersQuery = supabase
    .from('org_memberships')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  const { data: members, error: membersError } = await membersQuery

  if (membersError) throw new Error('クライアント一覧の取得に失敗しました: ' + membersError.message)

  let pendingInvites: ClientInvite[] = []

  if (params.includeInvites) {
    let invitesQuery = supabase
      .from('invites')
      .select('*')
      .eq('org_id', orgId)
      .eq('role', 'client')
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (params.spaceId) {
      invitesQuery = invitesQuery.eq('space_id', params.spaceId)
    }

    const { data: invites, error: invitesError } = await invitesQuery

    if (invitesError) throw new Error('招待一覧の取得に失敗しました: ' + invitesError.message)
    pendingInvites = (invites || []) as ClientInvite[]
  }

  return {
    members: (members || []) as OrgMembership[],
    pendingInvites,
  }
}

export async function clientGet(
  params: z.infer<typeof clientGetSchema>
): Promise<{ membership: OrgMembership; spaces: SpaceMembership[] }> {
  const { ctx } = await checkAuthOrg('read', 'client_get')
  const supabase = getSupabaseClient()
  const orgId = ctx.orgId

  // Get org membership
  const { data: membership, error: membershipError } = await supabase
    .from('org_memberships')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', params.userId)
    .single()

  if (membershipError) throw new Error('クライアントが見つかりません: ' + membershipError.message)

  // Get space memberships (org_id でフィルタして cross-org 漏洩を防止)
  const { data: orgSpaces } = await supabase
    .from('spaces')
    .select('id')
    .eq('org_id', orgId)

  const orgSpaceIds = (orgSpaces || []).map((s: { id: string }) => s.id)

  const { data: spaces, error: spacesError } = await supabase
    .from('space_memberships')
    .select('*')
    .eq('user_id', params.userId)
    .in('space_id', orgSpaceIds.length > 0 ? orgSpaceIds : ['__none__'])

  if (spacesError) throw new Error('スペース情報の取得に失敗しました: ' + spacesError.message)

  return {
    membership: membership as OrgMembership,
    spaces: (spaces || []) as SpaceMembership[],
  }
}

export async function clientUpdate(
  params: z.infer<typeof clientUpdateSchema>
): Promise<SpaceMembership> {
  const { ctx, role: callerRole } = await checkAuth(params.spaceId, 'write', 'client_update', 'client', params.userId)
  if (callerRole !== 'admin') {
    throw new ToolUserError('この操作はプロジェクトの管理者(admin)だけができます', 403)
  }
  if (ctx.userId && ctx.userId === params.userId) {
    throw new ToolUserError('自分自身の役割は変更できません', 403)
  }

  const supabase = getSupabaseClient()

  const { data: current, error: currentError } = await supabase
    .from('space_memberships')
    .select('role')
    .eq('space_id', params.spaceId)
    .eq('user_id', params.userId)
    .maybeSingle()
  if (currentError) throw new Error('現在の役割の確認に失敗しました')
  if (!current) throw new ToolUserError('対象のユーザーはこのプロジェクトのメンバーではありません', 404)
  if ((current as { role: string }).role === 'admin') {
    throw new ToolUserError('管理者(admin)の役割は、この操作では変更できません', 403)
  }

  // 組織のオーナーは、space の役割に関わらず変更させない
  const orgId = await getOrgId(params.spaceId)
  const { data: orgMembership, error: orgMemberError } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', params.userId)
    .maybeSingle()
  if (orgMemberError) throw new Error('組織メンバーの確認に失敗しました')
  const orgRole = (orgMembership as { role: string } | null)?.role
  if (orgRole === 'owner') {
    throw new ToolUserError('組織のオーナーの役割は変更できません', 403)
  }

  // space の役割は、組織での役割とそろえる（組織 client → space client、それ以外 →
  // space viewer）。相手先(client)を社内扱いの役割に変える・その逆はできない
  const expectedRole = orgRole === 'client' ? 'client' : 'viewer'
  if (params.role !== expectedRole) {
    throw new ToolUserError(
      `組織での役割（${orgRole}）と合わないロールです。${expectedRole} を指定してください`,
      400
    )
  }

  const { data, error } = await supabase
    .from('space_memberships')
    .update({ role: params.role })
    .eq('space_id', params.spaceId)
    .eq('user_id', params.userId)
    .select('*')
    .single()

  if (error) throw new Error('クライアントの更新に失敗しました: ' + error.message)
  return data as SpaceMembership
}

export async function clientAddToSpace(
  params: z.infer<typeof clientAddToSpaceSchema>
): Promise<SpaceMembership> {
  const { role: callerRole } = await checkAuth(params.spaceId, 'write', 'client_add_to_space', 'client', params.userId)
  if (callerRole !== 'admin') {
    throw new ToolUserError('この操作はプロジェクトの管理者(admin)だけができます', 403)
  }

  // 対象は space の組織のメンバーだけ。役割は組織での役割と揃える
  // （組織 client → space client、それ以外 → space viewer。admin はこの道具では付けられない）
  const memberships = await assertUsersInSpaceOrg([params.userId], params.spaceId)
  const orgRole = memberships.get(params.userId)!.role
  const expectedRole = orgRole === 'client' ? 'client' : 'viewer'
  if (params.role !== expectedRole) {
    throw new ToolUserError(
      `組織での役割（${orgRole}）と合わないロールです。${expectedRole} を指定してください`,
      400
    )
  }

  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('space_memberships')
    .insert({
      space_id: params.spaceId,
      user_id: params.userId,
      role: params.role,
    })
    .select('*')
    .single()

  if (error) throw new Error('スペースへの追加に失敗しました: ' + error.message)
  return data as SpaceMembership
}

export async function clientInviteList(
  params: z.infer<typeof clientInviteListSchema>
): Promise<ClientInvite[]> {
  const { ctx } = await checkAuthOrg('read', 'client_invite_list')
  const supabase = getSupabaseClient()
  const orgId = ctx.orgId

  let query = supabase
    .from('invites')
    .select('*')
    .eq('org_id', orgId)
    .eq('role', 'client')
    .order('created_at', { ascending: false })

  if (params.role !== 'all') {
    query = query.eq('role', params.role)
  }

  if (params.spaceId) {
    query = query.eq('space_id', params.spaceId)
  }

  const now = new Date().toISOString()

  switch (params.status) {
    case 'pending':
      query = query.is('accepted_at', null).gt('expires_at', now)
      break
    case 'accepted':
      query = query.not('accepted_at', 'is', null)
      break
    case 'expired':
      query = query.is('accepted_at', null).lt('expires_at', now)
      break
    // 'all' - no filter
  }

  const { data, error } = await query

  if (error) throw new Error('招待一覧の取得に失敗しました: ' + error.message)
  return (data || []) as ClientInvite[]
}

export async function clientInviteResend(
  params: z.infer<typeof clientInviteResendSchema>
): Promise<ClientInvite> {
  const { ctx } = await checkAuthOrg('write', 'client_invite_resend')
  const supabase = getSupabaseClient()
  const orgId = ctx.orgId

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + params.expiresInDays)

  const newToken = generateToken()

  const { data, error } = await supabase
    .from('invites')
    .update({
      token: newToken,
      expires_at: expiresAt.toISOString(),
    })
    .eq('id', params.inviteId)
    .eq('org_id', orgId)
    .select('*')
    .single()

  if (error) throw new Error('招待の再送に失敗しました: ' + error.message)
  return data as ClientInvite
}

// Tool definitions for MCP
export const clientTools = [
  {
    name: 'client_invite_create',
    description: '招待を作成する。role=client なら相手先（ポータル）、role=member なら社内メンバー。招待リンクを返す（メールは送らない）',
    inputSchema: clientInviteCreateSchema,
    handler: clientInviteCreate,
  },
  {
    name: 'client_invite_bulk_create',
    description: 'クライアント一括招待(最大50件)',
    inputSchema: clientInviteBulkCreateSchema,
    handler: clientInviteBulkCreate,
  },
  {
    name: 'client_list',
    description: 'クライアント一覧取得。招待含む/除外可',
    inputSchema: clientListSchema,
    handler: clientList,
  },
  {
    name: 'client_get',
    description: 'クライアント詳細取得+参加スペース情報',
    inputSchema: clientGetSchema,
    handler: clientGet,
  },
  {
    name: 'client_update',
    description: 'クライアントのスペースロール更新',
    inputSchema: clientUpdateSchema,
    handler: clientUpdate,
  },
  {
    name: 'client_add_to_space',
    description: 'クライアントを別スペースに追加',
    inputSchema: clientAddToSpaceSchema,
    handler: clientAddToSpace,
  },
  {
    name: 'client_invite_list',
    description: '招待一覧。role で相手先／社内メンバー／両方を切り替え、status で保留・承諾済み・期限切れを絞る',
    inputSchema: clientInviteListSchema,
    handler: clientInviteList,
  },
  {
    name: 'client_invite_resend',
    description: '招待再送。新トークン+有効期限で更新',
    inputSchema: clientInviteResendSchema,
    handler: clientInviteResend,
  },
]

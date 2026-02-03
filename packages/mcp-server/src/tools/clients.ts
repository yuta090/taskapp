import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config } from '../config.js'
import crypto from 'crypto'

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
  email: z.string().email().describe('クライアントのメールアドレス'),
  spaceId: z.string().uuid().describe('招待先のスペース（プロジェクト）UUID'),
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
export async function clientInviteCreate(
  params: z.infer<typeof clientInviteCreateSchema>
): Promise<ClientInvite> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const actorId = config.actorId

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + params.expiresInDays)

  const token = generateToken()

  const { data, error } = await supabase
    .from('invites')
    .insert({
      org_id: orgId,
      space_id: params.spaceId,
      email: params.email.toLowerCase(),
      role: 'client',
      token,
      expires_at: expiresAt.toISOString(),
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw new Error('招待の作成に失敗しました: ' + error.message)
  return data as ClientInvite
}

export async function clientInviteBulkCreate(
  params: z.infer<typeof clientInviteBulkCreateSchema>
): Promise<{ created: number; failed: string[]; invites: ClientInvite[] }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
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
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  // Get org members with role='client'
  let membersQuery = supabase
    .from('org_memberships')
    .select('*')
    .eq('org_id', orgId)
    .eq('role', 'client')
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
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  // Get org membership
  const { data: membership, error: membershipError } = await supabase
    .from('org_memberships')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', params.userId)
    .single()

  if (membershipError) throw new Error('クライアントが見つかりません: ' + membershipError.message)

  // Get space memberships
  const { data: spaces, error: spacesError } = await supabase
    .from('space_memberships')
    .select('*')
    .eq('user_id', params.userId)

  if (spacesError) throw new Error('スペース情報の取得に失敗しました: ' + spacesError.message)

  return {
    membership: membership as OrgMembership,
    spaces: (spaces || []) as SpaceMembership[],
  }
}

export async function clientUpdate(
  params: z.infer<typeof clientUpdateSchema>
): Promise<SpaceMembership> {
  const supabase = getSupabaseClient()

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
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  let query = supabase
    .from('invites')
    .select('*')
    .eq('org_id', orgId)
    .eq('role', 'client')
    .order('created_at', { ascending: false })

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
  const supabase = getSupabaseClient()

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
    .select('*')
    .single()

  if (error) throw new Error('招待の再送に失敗しました: ' + error.message)
  return data as ClientInvite
}

// Tool definitions for MCP
export const clientTools = [
  {
    name: 'client_invite_create',
    description: 'クライアントを招待します。メールアドレスとスペースを指定して招待リンクを発行します。',
    inputSchema: clientInviteCreateSchema,
    handler: clientInviteCreate,
  },
  {
    name: 'client_invite_bulk_create',
    description: '複数のクライアントを一括招待します。最大50件まで同時に招待できます。',
    inputSchema: clientInviteBulkCreateSchema,
    handler: clientInviteBulkCreate,
  },
  {
    name: 'client_list',
    description: 'クライアント一覧を取得します。オプションで未承諾の招待も含めて表示できます。',
    inputSchema: clientListSchema,
    handler: clientList,
  },
  {
    name: 'client_get',
    description: 'クライアントの詳細情報を取得します。参加しているスペース情報も含まれます。',
    inputSchema: clientGetSchema,
    handler: clientGet,
  },
  {
    name: 'client_update',
    description: 'クライアントのスペースでのロールを更新します。',
    inputSchema: clientUpdateSchema,
    handler: clientUpdate,
  },
  {
    name: 'client_add_to_space',
    description: '既存のクライアントを別のスペース（プロジェクト）に追加します。',
    inputSchema: clientAddToSpaceSchema,
    handler: clientAddToSpace,
  },
  {
    name: 'client_invite_list',
    description: 'クライアント招待の一覧を取得します。ステータス（pending/accepted/expired/all）でフィルタできます。',
    inputSchema: clientInviteListSchema,
    handler: clientInviteList,
  },
  {
    name: 'client_invite_resend',
    description: '期限切れまたは未承諾の招待を再送します。新しいトークンと有効期限で更新されます。',
    inputSchema: clientInviteResendSchema,
    handler: clientInviteResend,
  },
]

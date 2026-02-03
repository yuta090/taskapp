import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config } from '../config.js'

// Types
export interface Review {
  id: string
  org_id: string
  space_id: string
  task_id: string
  status: 'open' | 'approved' | 'changes_requested'
  created_by: string
  created_at: string
  updated_at: string
}

export interface ReviewApproval {
  id: string
  org_id: string
  review_id: string
  reviewer_id: string
  state: 'pending' | 'approved' | 'blocked'
  blocked_reason: string | null
  created_at: string
  updated_at: string
}

// Schemas
export const reviewOpenSchema = z.object({
  taskId: z.string().uuid().describe('タスクUUID'),
  reviewerIds: z.array(z.string().uuid()).min(1).describe('レビュアーUUID配列（1人以上必須）'),
})

export const reviewApproveSchema = z.object({
  taskId: z.string().uuid().describe('タスクUUID'),
})

export const reviewBlockSchema = z.object({
  taskId: z.string().uuid().describe('タスクUUID'),
  reason: z.string().min(1).describe('ブロック理由'),
})

export const reviewListSchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUID'),
  status: z.enum(['open', 'approved', 'changes_requested']).optional().describe('ステータスでフィルタ'),
  limit: z.number().min(1).max(100).default(20).describe('取得件数'),
})

export const reviewGetSchema = z.object({
  taskId: z.string().uuid().describe('タスクUUID'),
})

// Tool implementations
export async function reviewOpen(params: z.infer<typeof reviewOpenSchema>): Promise<{ ok: boolean; review: Review }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Pre-validate: verify task belongs to current tenant before RPC
  const { data: existingTask, error: checkError } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (checkError || !existingTask) {
    throw new Error('タスクが見つかりません')
  }

  const { data, error } = await supabase.rpc('rpc_review_open', {
    p_task_id: params.taskId,
    p_reviewer_ids: params.reviewerIds,
    p_meeting_id: null,
  })

  if (error) throw new Error('レビューの開始に失敗しました')

  // Fetch the review with org/space scoping
  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select('*')
    .eq('task_id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (reviewError) throw new Error('レビューが見つかりません')

  return { ok: true, review: review as Review }
}

export async function reviewApprove(params: z.infer<typeof reviewApproveSchema>): Promise<{ ok: boolean; allApproved: boolean }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Pre-validate: verify task belongs to current tenant before RPC
  const { data: existingTask, error: checkError } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (checkError || !existingTask) {
    throw new Error('タスクが見つかりません')
  }

  const { data, error } = await supabase.rpc('rpc_review_approve', {
    p_task_id: params.taskId,
    p_meeting_id: null,
  })

  if (error) throw new Error('レビューの承認に失敗しました')

  return {
    ok: true,
    allApproved: data?.allApproved || false,
  }
}

export async function reviewBlock(params: z.infer<typeof reviewBlockSchema>): Promise<{ ok: boolean }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Pre-validate: verify task belongs to current tenant before RPC
  const { data: existingTask, error: checkError } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (checkError || !existingTask) {
    throw new Error('タスクが見つかりません')
  }

  const { data, error } = await supabase.rpc('rpc_review_block', {
    p_task_id: params.taskId,
    p_blocked_reason: params.reason,
    p_meeting_id: null,
  })

  if (error) throw new Error('レビューのブロックに失敗しました')

  return { ok: true }
}

export async function reviewList(params: z.infer<typeof reviewListSchema>): Promise<Review[]> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = params.spaceId || config.spaceId

  // Enforce org/space scoping
  let query = supabase
    .from('reviews')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(params.limit)

  if (params.status) {
    query = query.eq('status', params.status)
  }

  const { data, error } = await query

  if (error) throw new Error('レビュー一覧の取得に失敗しました')
  return (data || []) as Review[]
}

export async function reviewGet(params: z.infer<typeof reviewGetSchema>): Promise<{ review: Review | null; approvals: ReviewApproval[] }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Enforce org/space scoping
  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select('*')
    .eq('task_id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .maybeSingle()

  if (reviewError) throw new Error('レビューの取得に失敗しました')

  if (!review) {
    return { review: null, approvals: [] }
  }

  const { data: approvals, error: approvalsError } = await supabase
    .from('review_approvals')
    .select('*')
    .eq('review_id', review.id)
    .eq('org_id', orgId)

  if (approvalsError) throw new Error('承認状態の取得に失敗しました')

  return {
    review: review as Review,
    approvals: (approvals || []) as ReviewApproval[],
  }
}

// Tool definitions for MCP
export const reviewTools = [
  {
    name: 'review_open',
    description: 'タスクのレビューを開始します。レビュアーを1人以上指定必須。',
    inputSchema: reviewOpenSchema,
    handler: reviewOpen,
  },
  {
    name: 'review_approve',
    description: 'レビューを承認します。全員承認で自動クローズ。',
    inputSchema: reviewApproveSchema,
    handler: reviewApprove,
  },
  {
    name: 'review_block',
    description: 'レビューをブロック（変更リクエスト）します。理由必須。',
    inputSchema: reviewBlockSchema,
    handler: reviewBlock,
  },
  {
    name: 'review_list',
    description: 'レビュー一覧を取得します。statusでフィルタ可能。',
    inputSchema: reviewListSchema,
    handler: reviewList,
  },
  {
    name: 'review_get',
    description: 'タスクのレビュー詳細と各レビュアーの承認状態を取得します。',
    inputSchema: reviewGetSchema,
    handler: reviewGet,
  },
]

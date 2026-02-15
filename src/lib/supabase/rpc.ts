/**
 * RPC function wrappers for TaskApp business logic
 * These wrap the Supabase RPC calls with proper typing and error handling
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  BallSide,
  DecisionState,
  EvidenceType,
} from '@/types/database'

type Client = SupabaseClient<Database>

// =============================================================================
// Types for RPC responses
// =============================================================================

interface RpcResult {
  ok: boolean
}

interface MeetingEndResult extends RpcResult {
  summary_subject: string
  summary_body: string
  counts: {
    decided: number
    open: number
    ball_client: number
  }
}

interface MeetingMinutesResult {
  email_subject: string
  email_body: string
  in_app_title: string
  in_app_body: string
  counts: {
    decided: number
    open: number
    ball_client: number
  }
  nearest_due: string | null
}

// =============================================================================
// Error handling wrapper
// =============================================================================

async function callRpc<T>(
  client: Client,
  fnName: string,
  params: Record<string, unknown>
): Promise<T> {
  const { data, error } = await (client as SupabaseClient).rpc(fnName, params as Record<string, unknown>)

  if (error) {
    const msg = error.message || error.details || error.hint || `RPC ${fnName} failed`
    console.error(`RPC ${fnName} failed:`, { message: msg, code: error.code, details: error.details, hint: error.hint })
    throw new Error(msg)
  }

  return data as T
}

// =============================================================================
// 4.1 rpc_pass_ball
// =============================================================================

export interface PassBallParams {
  taskId: string
  ball: BallSide
  clientOwnerIds?: string[]
  internalOwnerIds?: string[]
  reason?: string
  meetingId?: string
}

export async function passBall(
  client: Client,
  params: PassBallParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_pass_ball', {
    p_task_id: params.taskId,
    p_ball: params.ball,
    p_client_owner_ids: params.clientOwnerIds || [],
    p_internal_owner_ids: params.internalOwnerIds || [],
    p_reason: params.reason || null,
    p_meeting_id: params.meetingId || null,
  })
}

// =============================================================================
// 4.2 rpc_decide_considering
// =============================================================================

export interface DecideConsideringParams {
  taskId: string
  decisionText: string
  onBehalfOf: BallSide
  evidence: EvidenceType
  clientConfirmedBy?: string
  meetingId?: string
}

export async function decideConsidering(
  client: Client,
  params: DecideConsideringParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_decide_considering', {
    p_task_id: params.taskId,
    p_decision_text: params.decisionText,
    p_on_behalf_of: params.onBehalfOf,
    p_evidence: params.evidence,
    p_client_confirmed_by: params.clientConfirmedBy || null,
    p_meeting_id: params.meetingId || null,
  })
}

// =============================================================================
// 4.3 rpc_set_spec_state
// =============================================================================

export interface SetSpecStateParams {
  taskId: string
  decisionState: DecisionState
  meetingId?: string
  note?: string
}

export async function setSpecState(
  client: Client,
  params: SetSpecStateParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_set_spec_state', {
    p_task_id: params.taskId,
    p_decision_state: params.decisionState,
    p_meeting_id: params.meetingId || null,
    p_note: params.note || null,
  })
}

// =============================================================================
// 4.4 rpc_review_open
// =============================================================================

export interface ReviewOpenParams {
  taskId: string
  reviewerIds: string[]
  meetingId?: string
}

export async function reviewOpen(
  client: Client,
  params: ReviewOpenParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_review_open', {
    p_task_id: params.taskId,
    p_reviewer_ids: params.reviewerIds,
    p_meeting_id: params.meetingId || null,
  })
}

// =============================================================================
// 4.5a rpc_review_approve
// =============================================================================

export interface ReviewApproveParams {
  taskId: string
  meetingId?: string
}

export async function reviewApprove(
  client: Client,
  params: ReviewApproveParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_review_approve', {
    p_task_id: params.taskId,
    p_meeting_id: params.meetingId || null,
  })
}

// =============================================================================
// 4.5b rpc_review_block
// =============================================================================

export interface ReviewBlockParams {
  taskId: string
  blockedReason: string
  meetingId?: string
}

export async function reviewBlock(
  client: Client,
  params: ReviewBlockParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_review_block', {
    p_task_id: params.taskId,
    p_blocked_reason: params.blockedReason,
    p_meeting_id: params.meetingId || null,
  })
}

// =============================================================================
// 4.6 rpc_meeting_start
// =============================================================================

export interface MeetingStartParams {
  meetingId: string
}

export async function meetingStart(
  client: Client,
  params: MeetingStartParams
): Promise<RpcResult> {
  return callRpc<RpcResult>(client, 'rpc_meeting_start', {
    p_meeting_id: params.meetingId,
  })
}

// =============================================================================
// 4.7 rpc_meeting_end
// =============================================================================

export interface MeetingEndParams {
  meetingId: string
}

export async function meetingEnd(
  client: Client,
  params: MeetingEndParams
): Promise<MeetingEndResult> {
  return callRpc<MeetingEndResult>(client, 'rpc_meeting_end', {
    p_meeting_id: params.meetingId,
  })
}

// =============================================================================
// 4.8 rpc_generate_meeting_minutes
// =============================================================================

export interface GenerateMeetingMinutesParams {
  meetingId: string
}

export async function generateMeetingMinutes(
  client: Client,
  params: GenerateMeetingMinutesParams
): Promise<MeetingMinutesResult> {
  return callRpc<MeetingMinutesResult>(client, 'rpc_generate_meeting_minutes', {
    p_meeting_id: params.meetingId,
  })
}

// =============================================================================
// 5.1 rpc_parse_meeting_minutes (AT-005)
// =============================================================================

export interface ParseMeetingMinutesParams {
  meetingId: string
  minutesMd: string
}

interface CreatedTask {
  task_id: string
  title: string
  spec_path: string
  due_date: string | null
  line_number: number
}

interface ParseMeetingMinutesResult extends RpcResult {
  created_count: number
  created_tasks: CreatedTask[]
  updated_minutes: string
}

export async function parseMeetingMinutes(
  client: Client,
  params: ParseMeetingMinutesParams
): Promise<ParseMeetingMinutesResult> {
  return callRpc<ParseMeetingMinutesResult>(client, 'rpc_parse_meeting_minutes', {
    p_meeting_id: params.meetingId,
    p_minutes_md: params.minutesMd,
  })
}

// =============================================================================
// 5.2 rpc_get_minutes_preview (AT-005)
// =============================================================================

export interface GetMinutesPreviewParams {
  meetingId: string
  minutesMd: string
}

interface SpecPreviewItem {
  line_number: number
  spec_path: string
  title: string
  task_id?: string
}

interface GetMinutesPreviewResult {
  new_spec_count: number
  existing_spec_count: number
  new_specs: SpecPreviewItem[]
  existing_specs: SpecPreviewItem[]
}

export async function getMinutesPreview(
  client: Client,
  params: GetMinutesPreviewParams
): Promise<GetMinutesPreviewResult> {
  return callRpc<GetMinutesPreviewResult>(client, 'rpc_get_minutes_preview', {
    p_meeting_id: params.meetingId,
    p_minutes_md: params.minutesMd,
  })
}

// =============================================================================
// 6.1 rpc_confirm_proposal_slot (Scheduling)
// =============================================================================

export interface ConfirmProposalSlotParams {
  proposalId: string
  slotId: string
}

interface ConfirmProposalSlotResult {
  ok: boolean
  meeting_id?: string
  slot_start?: string
  slot_end?: string
  error?: string
  current_status?: string
  required?: number
  eligible?: number
}

export async function confirmProposalSlot(
  client: Client,
  params: ConfirmProposalSlotParams
): Promise<ConfirmProposalSlotResult> {
  return callRpc<ConfirmProposalSlotResult>(client, 'rpc_confirm_proposal_slot', {
    p_proposal_id: params.proposalId,
    p_slot_id: params.slotId,
  })
}

// =============================================================================
// Export all functions as a namespace
// =============================================================================

export const rpc = {
  passBall,
  decideConsidering,
  setSpecState,
  reviewOpen,
  reviewApprove,
  reviewBlock,
  meetingStart,
  meetingEnd,
  generateMeetingMinutes,
  parseMeetingMinutes,
  getMinutesPreview,
  confirmProposalSlot,
}

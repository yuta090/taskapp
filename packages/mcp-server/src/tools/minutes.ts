import { z } from 'zod'
import { getSupabaseClient, Meeting } from '../supabase/client.js'
import { config } from '../config.js'

// ── Schemas ──────────────────────────────────────────────

const minutesGetSchema = z.object({
  meetingId: z.string().describe('会議ID'),
})

const minutesUpdateSchema = z.object({
  meetingId: z.string().describe('会議ID'),
  minutesMd: z.string().describe('議事録本文（Markdown）'),
})

const minutesAppendSchema = z.object({
  meetingId: z.string().describe('会議ID'),
  content: z.string().describe('追記する内容（Markdown）'),
})

// ── Helpers ──────────────────────────────────────────────

async function getMeetingScoped(meetingId: string): Promise<Meeting> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (error || !data) throw new Error('会議が見つかりません')
  return data as Meeting
}

// ── Handlers ─────────────────────────────────────────────

export async function minutesGet(params: z.infer<typeof minutesGetSchema>): Promise<{ meeting_id: string; title: string; status: string; minutes_md: string | null }> {
  const meeting = await getMeetingScoped(params.meetingId)
  return {
    meeting_id: meeting.id,
    title: meeting.title,
    status: meeting.status,
    minutes_md: meeting.minutes_md,
  }
}

export async function minutesUpdate(params: z.infer<typeof minutesUpdateSchema>): Promise<Meeting> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Verify meeting exists and belongs to org/space
  await getMeetingScoped(params.meetingId)

  const { data, error } = await supabase
    .from('meetings')
    .update({ minutes_md: params.minutesMd })
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .select('*')
    .single()

  if (error) throw new Error('議事録の更新に失敗しました')
  return data as Meeting
}

export async function minutesAppend(params: z.infer<typeof minutesAppendSchema>): Promise<Meeting> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Verify meeting exists and belongs to org/space
  const meeting = await getMeetingScoped(params.meetingId)

  // Atomic append using DB-side concatenation via rpc to avoid lost-update race.
  // Falls back to read-then-write if rpc is unavailable.
  let updated: string
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_minutes_append', {
      p_meeting_id: params.meetingId,
      p_org_id: orgId,
      p_space_id: spaceId,
      p_content: params.content,
    })

    if (!rpcError && rpcResult) {
      // RPC returns the updated meeting row
      return rpcResult as Meeting
    }

    // RPC not available — fall back to read-then-write
    const current = meeting.minutes_md || ''
    updated = current ? `${current}\n\n${params.content}` : params.content
  } catch {
    // RPC not available — fall back to read-then-write
    const current = meeting.minutes_md || ''
    updated = current ? `${current}\n\n${params.content}` : params.content
  }

  const { data, error } = await supabase
    .from('meetings')
    .update({ minutes_md: updated })
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .select('*')
    .single()

  if (error) throw new Error('議事録の追記に失敗しました')
  return data as Meeting
}

// ── Tool definitions ─────────────────────────────────────

export const minutesTools = [
  {
    name: 'minutes_get',
    description: '会議の議事録（minutes_md）を取得します。',
    inputSchema: minutesGetSchema,
    handler: minutesGet,
  },
  {
    name: 'minutes_update',
    description: '会議の議事録を上書き更新します。',
    inputSchema: minutesUpdateSchema,
    handler: minutesUpdate,
  },
  {
    name: 'minutes_append',
    description: '会議の議事録に内容を追記します。既存内容の末尾に追加。',
    inputSchema: minutesAppendSchema,
    handler: minutesAppend,
  },
]

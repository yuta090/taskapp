import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { checkAuth } from '../auth/helpers.js'
import { requireActorUserId } from '../auth/scope.js'
import { mapRaiseExceptionError } from '../lib/rpcErrors.js'
import { buildTaskLink } from '../lib/appLinks.js'

/**
 * 議事録から「決める札」を作る道具。画面の会議「タスク化」タブと同じもの。
 *
 * 拾うのは未チェックのチェックリスト行で、Wiki ページへのリンクが入っているもの
 * （または旧来の `SPEC(/spec/FILE.md#anchor)` 行）。紐づけ先が「仕様書として扱う」の
 * ページなら決める札、そうでなければ参考資料付きのふつうのタスクになる。
 * 詳しくは docs/spec/MEETING_MINUTES_TEMPLATE.md。
 */

const baseSchema = {
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  meetingId: z.string().uuid().describe('会議UUID'),
}

export const minutesTaskifyPreviewSchema = z.object(baseSchema)

export const minutesTaskifySchema = z.object({
  ...baseSchema,
  dryRun: z
    .boolean()
    .optional()
    .describe('true なら候補を数えるだけで作らない（既定 false）'),
})

interface RawCandidate {
  line_number: number
  title: string
  spec_path?: string | null
  wiki_page_id?: string | null
  wiki_page_title?: string | null
  is_spec?: boolean | null
  task_id?: string | null
}

export interface TaskifyCandidate {
  lineNumber: number
  title: string
  /** 紐づく資料の名前（Wiki のページ名。旧来の行なら仕様書のパス） */
  source: string
  /** 決める札になるか（決まるまで完了できない） */
  isDecision: boolean
}

export interface TaskifyPreviewResult {
  newCount: number
  existingCount: number
  candidates: TaskifyCandidate[]
}

export interface TaskifyResult {
  ok: boolean
  createdCount: number
  created: Array<{ taskId: string; title: string; isDecision: boolean; link: string }>
  /** dryRun のときだけ。作らずに数えた結果 */
  preview?: TaskifyPreviewResult
}

function toCandidate(row: RawCandidate): TaskifyCandidate {
  return {
    lineNumber: row.line_number,
    title: row.title,
    source: row.wiki_page_title ?? row.spec_path ?? '',
    // 旧来の SPEC 行は常に決める札。Wiki の行は「仕様書」タグの有無を DB が入れてくる
    isDecision: row.is_spec ?? (row.spec_path != null),
  }
}

/** 会議の本文を、org/space の範囲を確かめたうえで読む */
async function readMinutes(spaceId: string, meetingId: string) {
  const supabase = getSupabaseClient()
  const { data: space, error: spaceError } = await supabase
    .from('spaces')
    .select('org_id')
    .eq('id', spaceId)
    .single()
  if (spaceError || !space) throw new Error('スペースが見つかりません')
  const orgId = (space as { org_id: string }).org_id

  const { data, error } = await supabase
    .from('meetings')
    .select('id, minutes_md')
    .eq('id', meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()
  if (error || !data) throw new Error('会議が見つかりません')

  return { orgId, minutesMd: (data as { minutes_md: string | null }).minutes_md ?? '' }
}

export async function minutesTaskifyPreview(
  params: z.infer<typeof minutesTaskifyPreviewSchema>
): Promise<TaskifyPreviewResult> {
  await checkAuth(params.spaceId, 'read', 'minutes_taskify_preview', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()
  const { minutesMd } = await readMinutes(params.spaceId, params.meetingId)
  const actor = requireActorUserId()

  const { data, error } = await supabase.rpc('rpc_get_minutes_preview_as', {
    p_actor: actor,
    p_meeting_id: params.meetingId,
    p_minutes_md: minutesMd,
  })
  if (error) throw mapRaiseExceptionError(error.message, 'タスク化の候補を取れませんでした')

  const result = data as {
    new_spec_count: number
    existing_spec_count: number
    new_specs?: RawCandidate[] | null
  }
  return {
    newCount: result.new_spec_count,
    existingCount: result.existing_spec_count,
    candidates: (result.new_specs ?? []).map(toCandidate),
  }
}

export async function minutesTaskify(
  params: z.infer<typeof minutesTaskifySchema>
): Promise<TaskifyResult> {
  await checkAuth(params.spaceId, 'write', 'minutes_taskify', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()
  const { orgId, minutesMd } = await readMinutes(params.spaceId, params.meetingId)

  if (params.dryRun) {
    const preview = await minutesTaskifyPreview({
      spaceId: params.spaceId,
      meetingId: params.meetingId,
    })
    return { ok: true, createdCount: 0, created: [], preview }
  }

  const actor = requireActorUserId()

  // 直前に読んだ本文をそのまま渡す。DB 側が「渡された本文＝いまの本文」を確かめ、
  // 違えば何も書かずに止める（この隙間に入った他の人・AI秘書の書き込みを消さないため）
  const { data, error } = await supabase.rpc('rpc_parse_meeting_minutes_as', {
    p_actor: actor,
    p_meeting_id: params.meetingId,
    p_minutes_md: minutesMd,
  })
  if (error) throw mapRaiseExceptionError(error.message, 'タスク化に失敗しました')

  const result = data as {
    created_count: number
    created_tasks?: Array<{ task_id: string; title: string; is_spec?: boolean; spec_path?: string }> | null
  }

  return {
    ok: true,
    createdCount: result.created_count,
    created: (result.created_tasks ?? []).map((t) => ({
      taskId: t.task_id,
      title: t.title,
      isDecision: t.is_spec ?? t.spec_path != null,
      link: buildTaskLink(orgId, params.spaceId, t.task_id),
    })),
  }
}

export const minutesTaskifyTools = [
  {
    name: 'minutes_taskify_preview',
    description:
      '議事録から作れる札の候補を、作らずに見る（画面の会議「タスク化」タブと同じ）',
    inputSchema: minutesTaskifyPreviewSchema,
    handler: minutesTaskifyPreview,
  },
  {
    name: 'minutes_taskify',
    description:
      '議事録から札を作る（画面の会議「タスク化」タブと同じ）。未チェックのチェックリスト行に Wiki ページのリンクがあるものを拾う。作成済みの行は飛ばす',
    inputSchema: minutesTaskifySchema,
    handler: minutesTaskify,
  },
]

import { z } from 'zod'
import { getSupabaseClient, WikiPage, WikiPageVersion } from '../supabase/client.js'
import { config } from '../config.js'
import { checkAuth } from '../auth/helpers.js'
import { toWikiBlocksJson, type WikiBodyFormat } from '../lib/wikiBody.js'
import { assertInSpace } from '../auth/scope.js'
import { ToolUserError } from '../errors.js'
import { buildWikiPageLink, withLink } from '../lib/appLinks.js'

const bodyFormatSchema = z
  .enum(['markdown', 'html', 'blocks'])
  .optional()
  .describe('本文の形式。省略時は自動判定（JSONブロック配列→blocks / HTML→html / それ以外→markdown）')

// ── Helpers ──────────────────────────────────────────────

async function getOrgId(spaceId: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  if (error || !data) throw new Error('スペースが見つかりません')
  return data.org_id
}

// ── Schemas ──────────────────────────────────────────────

const wikiListSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  limit: z.number().int().positive().max(200).default(50).describe('取得件数上限'),
})

/**
 * CLI のフラグは文字列しか運べず「値なし(null)」を送れないので、解除の合言葉を受け取って null に読み替える。
 * 例: `agentpm wiki update --page-id <id> --parent-page-id none`（親を外して根に戻す）
 */
const CLEAR_WORDS = new Set(['none', 'null', ''])
const nullableIdSchema = z.preprocess(
  (v) => (typeof v === 'string' && CLEAR_WORDS.has(v.trim().toLowerCase()) ? null : v),
  z.string().uuid().nullable().optional()
)

const wikiGetSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  pageId: z.string().describe('WikiページID'),
})

const wikiCreateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  title: z.string().describe('ページタイトル'),
  body: z.string().optional().describe('ページ本文（Markdown / HTML / BlockNote JSON。保存時に画面と同じブロック形式へ変換）'),
  format: bodyFormatSchema,
  tags: z.array(z.string()).optional().describe('タグ配列（「仕様書」を付けるとタスクの「仕様書連携」で選べる）'),
})

export const wikiUpdateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  pageId: z.string().describe('WikiページID'),
  title: z.string().optional().describe('タイトル'),
  body: z.string().optional().describe('本文（Markdown / HTML / BlockNote JSON。保存時に画面と同じブロック形式へ変換）'),
  format: bodyFormatSchema,
  tags: z.array(z.string()).optional().describe('タグ配列'),
  parentPageId: nullableIdSchema.describe('親ページID（フォルダ表示）。null または none で根に戻す。別スペースの親・循環はDB側で拒否される'),
  milestoneId: nullableIdSchema.describe('紐づけるマイルストーンID。null または none で解除'),
  pinned: z.boolean().optional().describe('true で一覧の先頭に固定、false で解除'),
})

const wikiDeleteSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  pageId: z.string().describe('WikiページID'),
})

const wikiVersionsSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  pageId: z.string().describe('WikiページID'),
  limit: z.number().int().positive().max(100).default(20).describe('取得件数上限'),
})

// ── Handlers ─────────────────────────────────────────────

export async function wikiList(params: z.infer<typeof wikiListSchema>): Promise<WikiPage[]> {
  await checkAuth(params.spaceId, 'read', 'wiki_list', 'wiki')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data, error } = await supabase
    .from('wiki_pages')
    .select(
      'id, org_id, space_id, title, tags, parent_page_id, milestone_id, pinned_at, sort_order, created_by, updated_by, created_at, updated_at'
    )
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .order('updated_at', { ascending: false })
    .limit(params.limit)

  if (error) throw new Error('Wikiページ一覧の取得に失敗しました')
  // link はそのまま Wiki・議事録の本文に貼れる（画面側の「リンクを挿入」と同じ形）
  return ((data || []) as WikiPage[]).map((page) =>
    withLink(page, buildWikiPageLink(orgId, params.spaceId, page.id))
  ) as WikiPage[]
}

export async function wikiGet(params: z.infer<typeof wikiGetSchema>): Promise<WikiPage> {
  await checkAuth(params.spaceId, 'read', 'wiki_get', 'wiki', params.pageId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data, error } = await supabase
    .from('wiki_pages')
    .select('*')
    .eq('id', params.pageId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (error) throw new Error('Wikiページが見つかりません')
  return withLink(data as WikiPage, buildWikiPageLink(orgId, params.spaceId, params.pageId)) as WikiPage
}

export async function wikiCreate(params: z.infer<typeof wikiCreateSchema>): Promise<WikiPage> {
  await checkAuth(params.spaceId, 'write', 'wiki_create', 'wiki')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)
  const actorId = config.actorId
  // Wiki 画面はブロック JSON しか読めない。Markdown/HTML のまま保存すると画面で空に見える
  const body = await toWikiBlocksJson(params.body || '', params.format as WikiBodyFormat | undefined)

  const { data, error } = await supabase
    .from('wiki_pages')
    .insert({
      org_id: orgId,
      space_id: params.spaceId,
      title: params.title,
      body,
      tags: params.tags || [],
      created_by: actorId,
      updated_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw new Error('Wikiページの作成に失敗しました')
  return data as WikiPage
}

/** DB トリガーの拒否理由（親子・マイルストーンの境界/循環）を利用者向けの日本語に置き換える。 */
export function describeWikiUpdateError(message: string | undefined): string {
  const m = message ?? ''
  if (m.includes('wiki parent cycle')) return '親ページの指定が循環しています（自分自身や子孫を親にはできません）'
  if (m.includes('wiki parent chain too deep')) return '親ページの階層が深すぎます（最大 50 段）'
  if (m.includes('wiki parent must be in the same space')) return '親ページは同じスペースのページだけ指定できます'
  if (m.includes('wiki milestone must be in the same space')) return 'マイルストーンは同じスペースのものだけ指定できます'
  return 'Wikiページの更新に失敗しました'
}

const WIKI_UPDATE_KNOWN_REASONS = [
  'wiki parent cycle',
  'wiki parent chain too deep',
  'wiki parent must be in the same space',
  'wiki milestone must be in the same space',
]

/**
 * DB が断った理由が見覚えのあるもの（親子・マイルストーンの境界/循環）なら、決まった
 * 日本語の ToolUserError(400) にする。見覚えのない理由は中身を隠した一般のエラーのまま返す。
 */
function toWikiUpdateError(message: string | undefined): Error {
  const known = WIKI_UPDATE_KNOWN_REASONS.some((reason) => (message ?? '').includes(reason))
  if (known) return new ToolUserError(describeWikiUpdateError(message), 400)
  return new Error(describeWikiUpdateError(message))
}

export async function wikiUpdate(params: z.infer<typeof wikiUpdateSchema>): Promise<WikiPage> {
  await checkAuth(params.spaceId, 'write', 'wiki_update', 'wiki', params.pageId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)
  const actorId = config.actorId

  // Build update payload
  const updateData: Record<string, unknown> = { updated_by: actorId }
  if (params.title !== undefined) updateData.title = params.title
  if (params.body !== undefined) {
    updateData.body = await toWikiBlocksJson(params.body, params.format as WikiBodyFormat | undefined)
  }
  if (params.tags !== undefined) updateData.tags = params.tags
  if (params.parentPageId !== undefined) updateData.parent_page_id = params.parentPageId
  if (params.milestoneId !== undefined) updateData.milestone_id = params.milestoneId
  if (params.pinned !== undefined) updateData.pinned_at = params.pinned ? new Date().toISOString() : null

  const { data, error } = await supabase
    .from('wiki_pages')
    .update(updateData)
    .eq('id', params.pageId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .select('*')
    .single()

  if (error) throw toWikiUpdateError(error.message)

  // Save version snapshot when body changes
  if (params.body !== undefined) {
    const { error: vErr } = await supabase
      .from('wiki_page_versions')
      .insert({
        org_id: orgId,
        page_id: params.pageId,
        title: (data as WikiPage).title,
        body: params.body,
        created_by: actorId,
      })

    if (vErr) console.error('バージョン保存失敗:', vErr.message)
  }

  return data as WikiPage
}

export async function wikiDelete(params: z.infer<typeof wikiDeleteSchema>): Promise<{ ok: true }> {
  await checkAuth(params.spaceId, 'delete', 'wiki_delete', 'wiki', params.pageId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { error } = await supabase
    .from('wiki_pages')
    .delete()
    .eq('id', params.pageId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)

  if (error) throw new Error('Wikiページの削除に失敗しました')
  return { ok: true }
}

export async function wikiVersions(params: z.infer<typeof wikiVersionsSchema>): Promise<WikiPageVersion[]> {
  await checkAuth(params.spaceId, 'read', 'wiki_versions', 'wiki', params.pageId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)
  // wiki_page_versions に space_id の列が無いため、先に wiki_pages がこの space の
  // ものと確かめてから版を引く
  await assertInSpace('wiki_pages', params.pageId, params.spaceId, 'Wikiページが見つかりません')

  const { data, error } = await supabase
    .from('wiki_page_versions')
    .select('*')
    .eq('page_id', params.pageId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(params.limit)

  if (error) throw new Error('バージョン履歴の取得に失敗しました')
  return (data || []) as WikiPageVersion[]
}

// ── Tool definitions ─────────────────────────────────────

export const wikiTools = [
  {
    name: 'wiki_list',
    description: 'Wiki一覧取得(タイトル・タグのみ、本文除く)',
    inputSchema: wikiListSchema,
    handler: wikiList,
  },
  {
    name: 'wiki_get',
    description: 'Wikiページ詳細取得(本文含む)',
    inputSchema: wikiGetSchema,
    handler: wikiGet,
  },
  {
    name: 'wiki_create',
    description: 'Wikiページ新規作成',
    inputSchema: wikiCreateSchema,
    handler: wikiCreate,
  },
  {
    name: 'wiki_update',
    description: 'Wikiページ更新。本文変更時バージョン自動保存',
    inputSchema: wikiUpdateSchema,
    handler: wikiUpdate,
  },
  {
    name: 'wiki_delete',
    description: '【破壊的】Wikiページ削除',
    inputSchema: wikiDeleteSchema,
    handler: wikiDelete,
  },
  {
    name: 'wiki_versions',
    description: 'Wikiバージョン履歴取得',
    inputSchema: wikiVersionsSchema,
    handler: wikiVersions,
  },
]

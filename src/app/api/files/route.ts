import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { FILES_LIST_LIMIT } from '@/lib/files/limits'
import { getKindMatchPatterns, type FileKind } from '@/lib/files/filters'
import { UNKNOWN_PROFILE_LABEL } from '@/lib/labels'

const MAX_SEARCH_LENGTH = 200
const KINDS: FileKind[] = ['image', 'pdf', 'document', 'table', 'other']
const VISIBILITIES = ['visible', 'hidden'] as const
const ORIGINS = ['internal', 'client'] as const

/**
 * 検索語を PostgREST の or= に載せる形にする。エスケープは二段必要。
 *
 * 1. SQL の LIKE: % と _ はワイルドカードなので \ を付けて文字として扱わせる
 * 2. PostgREST: 値は「,」「.」「(」「)」で構文が決まるのでダブルクォートで包む。
 *    その引用符の中では \ と " 自体がエスケープ文字なので、もう一段重ねる
 *
 * 一段しかかけないと PostgREST 側で消費されて素の % _ に戻り、
 * ワイルドカードとして効いてしまう(「100_」が「100%」に当たる)。
 */
function toLikePattern(raw: string): string {
  const sqlPattern = `%${raw.replace(/([\\%_])/g, '\\$1')}%`
  const quoted = sqlPattern.replace(/([\\"])/g, '\\$1')
  return `"${quoted}"`
}

// GET: スペースの公開済み(status='ready')ファイル一覧
// 500件を超えるスペースでも古いファイルを探せるよう、絞り込みをSQL側でも受ける。
// kind は「取りこぼさない超集合」で絞り、正確な判定はクライアントが getFileKind でかける。
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')

    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'Invalid or missing spaceId' }, { status: 400 })
    }

    const q = searchParams.get('q')?.trim() || ''
    const kind = searchParams.get('kind')
    const visibility = searchParams.get('visibility')
    const origin = searchParams.get('origin')

    if (q.length > MAX_SEARCH_LENGTH) {
      return NextResponse.json({ error: `q must be at most ${MAX_SEARCH_LENGTH} chars` }, { status: 400 })
    }
    if (kind && !KINDS.includes(kind as FileKind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (visibility && !VISIBILITIES.includes(visibility as (typeof VISIBILITIES)[number])) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 })
    }
    if (origin && !ORIGINS.includes(origin as (typeof ORIGINS)[number])) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 400 })
    }

    // Authorization: space member（可視範囲そのものはRLSに従うが、
    // メンバーでないユーザーに403を明示するためのチェック）。
    // 一覧の取得と直列にすると検索の待ちが1段ぶん伸びるので並列に投げ、判定は結果を見てから行う
    // (メンバーでなければ RLS 側でも行は返らないので、先に走らせても漏れない)。
    const membershipPromise = (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    let query = (supabase as SupabaseClient)
      .from('files')
      .select('id, name, description, mime_type, size_bytes, origin, client_visible, uploaded_by, created_at')
      .eq('space_id', spaceId)
      .eq('status', 'ready')

    if (q) {
      const pattern = toLikePattern(q)
      query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`)
    }

    if (kind) {
      const patterns = getKindMatchPatterns(kind as FileKind)
      // kind='other' は「どれにも当てはまらない」ので列挙できない。SQLでは絞らず
      // クライアント側の getFileKind に任せる
      if (patterns) {
        const conditions = [
          ...patterns.mimeContains.map((m) => `mime_type.ilike."%${m}%"`),
          ...patterns.nameEndsWith.map((ext) => `name.ilike."%${ext}"`),
        ]
        query = query.or(conditions.join(','))
      }
    }

    if (visibility === 'visible') {
      // クライアント提供ファイルは仕様上つねに公開扱い
      query = query.or('client_visible.eq.true,origin.eq.client')
    } else if (visibility === 'hidden') {
      query = query.eq('client_visible', false).eq('origin', 'internal')
    }

    if (origin) {
      query = query.eq('origin', origin)
    }

    // 「まだ続きがあるか」を知るために上限+1件だけ取る
    const [{ data: membership }, { data: files, error }] = await Promise.all([
      membershipPromise,
      query.order('created_at', { ascending: false }).limit(FILES_LIST_LIMIT + 1),
    ])

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (error) {
      console.error('Fetch files error:', error)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }

    const all = files || []
    const hasMore = all.length > FILES_LIST_LIMIT
    const rows = hasMore ? all.slice(0, FILES_LIST_LIMIT) : all

    const uploaderIds = [...new Set(rows.map((f: { uploaded_by: string }) => f.uploaded_by))]
    const nameMap: Record<string, string> = {}

    if (uploaderIds.length > 0) {
      const { data: profiles } = await (supabase as SupabaseClient)
        .from('profiles')
        .select('id, display_name')
        .in('id', uploaderIds)

      for (const p of profiles || []) {
        nameMap[p.id] = p.display_name || ''
      }
    }

    const result = rows.map((f: {
      id: string
      name: string
      description: string | null
      mime_type: string
      size_bytes: number
      origin: string
      client_visible: boolean
      uploaded_by: string
      created_at: string
    }) => ({
      id: f.id,
      name: f.name,
      description: f.description ?? null,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      origin: f.origin,
      clientVisible: f.client_visible,
      uploadedBy: f.uploaded_by,
      uploaderName: nameMap[f.uploaded_by] || UNKNOWN_PROFILE_LABEL,
      createdAt: f.created_at,
    }))

    return NextResponse.json({ files: result, hasMore })
  } catch (error) {
    console.error('List files error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

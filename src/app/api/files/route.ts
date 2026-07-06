import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'

// GET: スペースの公開済み(status='ready')ファイル一覧
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

    // Authorization: space member（可視範囲そのものはRLSに従うが、
    // メンバーでないユーザーに403を明示するためのチェック）
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { data: files, error } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, name, mime_type, size_bytes, origin, client_visible, uploaded_by, created_at')
      .eq('space_id', spaceId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Fetch files error:', error)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }

    const rows = files || []

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
      mime_type: string
      size_bytes: number
      origin: string
      client_visible: boolean
      uploaded_by: string
      created_at: string
    }) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      origin: f.origin,
      clientVisible: f.client_visible,
      uploadedBy: f.uploaded_by,
      uploaderName: nameMap[f.uploaded_by] || 'メンバー',
      createdAt: f.created_at,
    }))

    return NextResponse.json({ files: result })
  } catch (error) {
    console.error('List files error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

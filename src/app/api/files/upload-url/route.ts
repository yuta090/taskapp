import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'

const MAX_FILE_SIZE_BYTES = 52428800
const MAX_NAME_LENGTH = 255

// POST: 署名アップロードURLを発行し、files に pending 行を作成する。
// バイトの入出力は署名URL経由のみ(このルートは行の作成とURL発行だけを行う)。
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { spaceId, name, mimeType, sizeBytes } = body as {
      spaceId?: string
      name?: string
      mimeType?: string
      sizeBytes?: number
    }

    // --- Validation ---
    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'Invalid or missing spaceId' }, { status: 400 })
    }
    if (!name || typeof name !== 'string' || name.length < 1 || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `name must be 1-${MAX_NAME_LENGTH} chars` }, { status: 400 })
    }
    if (name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: 'name must not contain path separators' }, { status: 400 })
    }
    const size = Number(sizeBytes)
    if (!Number.isFinite(size) || size < 1 || size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: `sizeBytes must be 1-${MAX_FILE_SIZE_BYTES}` }, { status: 400 })
    }

    // --- Authorization: space member ---
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { data: space } = await (supabase as SupabaseClient)
      .from('spaces')
      .select('org_id')
      .eq('id', spaceId)
      .single()

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // client/vendor がアップロードする場合は origin='client' かつ client_visible=true を強制
    const isClientRole = membership.role === 'client' || membership.role === 'vendor'
    const origin = isClientRole ? 'client' : 'internal'
    const clientVisible = isClientRole

    const fileId = crypto.randomUUID()
    const storagePath = `${spaceId}/${fileId}/${name}`

    const { data: fileRow, error: insertError } = await (supabase as SupabaseClient)
      .from('files')
      .insert({
        id: fileId,
        org_id: space.org_id,
        space_id: spaceId,
        uploaded_by: user.id,
        origin,
        client_visible: clientVisible,
        name,
        mime_type: mimeType || 'application/octet-stream',
        size_bytes: size,
        storage_path: storagePath,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insertError || !fileRow) {
      console.error('File insert error:', insertError)
      return NextResponse.json({ error: 'Failed to create file record' }, { status: 500 })
    }

    const admin = createAdminClient()
    const { data: signed, error: signedError } = await admin.storage
      .from('space-files')
      .createSignedUploadUrl(storagePath)

    if (signedError || !signed) {
      console.error('Signed upload URL error:', signedError)
      // 署名URL発行に失敗した行は誰もアップロードできないので削除しておく(ベストエフォート)
      await (supabase as SupabaseClient).from('files').delete().eq('id', fileId)
      return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
    }

    return NextResponse.json({
      fileId: fileRow.id,
      signedUrl: signed.signedUrl,
      token: signed.token,
      path: storagePath,
    })
  } catch (error) {
    console.error('Create upload URL error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
